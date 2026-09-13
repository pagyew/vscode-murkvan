import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import vscode from 'vscode';
import chokidar from 'chokidar';
import { Log } from './log';
import { StatusBar, type Status } from './statusBar';
import { getSetting } from './config';
import { getDiff, getPackagesToInstall, type DiffError, type PackageDiff } from './getDiff';
import { hashFile } from './hash';
import { ALL_LOCKFILE_NAMES, detectPackageManager, groupLockfilesByProject } from './packageManager';
import { aggregateStatus } from './aggregateStatus';
import { findArcRoot, getCurrentBranch } from './vcs';
import { runShellCommand } from './postSync';

const {window, workspace, commands} = vscode;

const LOCKFILE_HASH_KEY = 'lockfileHash';
/** Git and npm rewrite the lockfile in bursts; collapse them into one check. */
const CHANGE_DEBOUNCE_MS = 300;
/** Arc mounts its store over FUSE, where native watchers stay silent. */
const ARC_POLL_INTERVAL_MS = 1_000;
/** Lockfiles nested inside a dependency's own tree are never a project root. */
const LOCKFILE_SEARCH_EXCLUDE = '**/node_modules/**';

const DIFF_ERRORS: Record<DiffError, string> = {
	'manifest-not-found': 'package.json not found',
	'manifest-unreadable': 'package.json could not be parsed',
	'node-modules-not-found': 'node_modules not found — install dependencies once before Murkvan can compare them',
};

type NpmOutcome = 'success' | 'cancelled' | 'failed';

function describeDiff({packageName, declaredVersion, installedVersion, diffType, changeDirection}: PackageDiff) {
	const declared = declaredVersion ?? 'not declared';
	const installed = installedVersion ?? 'not installed';
	const direction = changeDirection === 'unknown' ? '' : `, ${changeDirection}`;

	return `${packageName}: declared ${declared}, installed ${installed} (${diffType}${direction})`;
}

interface Project {
	readonly projectDir: string;
	getStatus(): Status;
	getPendingPackages(): string[];
	/** Runs the discovery + hash-check + watcher setup that used to run once at activation. */
	initialize(): Promise<void>;
	checkPackages(): Promise<void>;
	installPackages(): Promise<void>;
	reinstallAll(): Promise<void>;
}

/**
 * Wraps one discovered lockfile — one npm/yarn/pnpm/bun project — with its
 * own package manager, pending-package list, in-flight install, and debounce
 * timer, so a multi-root workspace or a folder full of unrelated
 * sub-projects doesn't have them stepping on each other's state.
 *
 * `label` prefixes every message this project produces once there is more
 * than one project to tell apart; it is `undefined` in the common
 * single-project case, where the messages read exactly as they always have.
 */
function createProject(
	context: vscode.ExtensionContext,
	lockfilePath: string,
	label: string | undefined,
	onStatusChanged: () => void,
	log: Log,
): Project {
	const { subscriptions } = context;
	const packageManager = detectPackageManager(lockfilePath);
	const lockfileName = path.basename(lockfilePath);
	const projectDir = path.dirname(lockfilePath);
	const prefix = label ? `[${label}] ` : '';

	/**
	 * The current branch is re-read on every call rather than cached once,
	 * since a branch change is exactly the event that triggers a check in
	 * the first place. A non-git project (or `git` missing from `PATH`)
	 * always gets the same empty branch suffix, so it still ends up with one
	 * stable key — the exact behavior this project had before branch
	 * awareness, just under a differently-shaped key.
	 */
	function currentHashKey(): string {
		const branch = getCurrentBranch(projectDir);

		return `${LOCKFILE_HASH_KEY}:${projectDir}:${branch ?? ''}`;
	}

	let packagesToInstall: string[] = [];
	let status: Status = 'searching';
	let installation: ChildProcess | undefined;
	let debounceTimer: NodeJS.Timeout | undefined;

	function setStatus(next: Status) {
		status = next;
		onStatusChanged();
	}

	/**
	 * Spawns the detected package manager under a cancellable progress
	 * notification.
	 *
	 * @param packageCount how many packages this run targets, for the timing
	 * line logged on success — `undefined` for a full reinstall, where no
	 * count is known up front.
	 */
	async function runPackageManager(args: string[], progressTitle: string, packageCount: number | undefined): Promise<NpmOutcome> {
		setStatus('syncing');

		const startedAt = Date.now();

		log.info(`${prefix}Run command "${packageManager.command} ${args.join(' ')}"`);

		return window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: label ? `${progressTitle} (${label})` : progressTitle,
			cancellable: true
		}, (progress, token) => new Promise<NpmOutcome>(resolve => {
			const child = spawn(packageManager.command, args, { cwd: projectDir, windowsHide: true });
			let cancelled = false;
			let stderr = '';

			installation = child;

			child.stderr?.on('data', chunk => { stderr += chunk.toString(); });

			token.onCancellationRequested(() => {
				cancelled = true;
				child.kill();
			});

			child.on('error', error => {
				log.error(`${prefix}Failed to run ${packageManager.command}: ${error.message}`);
			});

			child.on('close', code => {
				installation = undefined;

				if (cancelled) {
					log.info(`${prefix}Packages sync cancelled!`);
					window.showInformationMessage(`${prefix}Packages sync cancelled!`);
					resolve('cancelled');
					return;
				}

				if (code === 0) {
					const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
					const scope = packageCount === undefined ? 'reinstalled everything' : `${packageCount} package${packageCount === 1 ? '' : 's'}`;

					log.info(`${prefix}Packages synced in ${durationSeconds}s (${scope})`);
					window.showInformationMessage(`${prefix}Packages synced!`);
					resolve('success');
					return;
				}

				log.error(`${prefix}${packageManager.command} exited with code ${code}${stderr ? `:\n${stderr.trim()}` : ''}`);
				window.showErrorMessage(`${prefix}Packages sync failed!`);
				resolve('failed');
			});
		}));
	}

	/**
	 * Runs `murkvan.postSyncCommand`, if set, in this project's directory
	 * after a successful sync. A non-zero exit is logged and surfaced as a
	 * warning rather than an error — the sync itself already succeeded.
	 */
	async function runPostSync(): Promise<void> {
		const command = getSetting('postSyncCommand', '');

		if (!command) {
			return;
		}

		log.info(`${prefix}Run post-sync command "${command}"`);

		const { code, stdout, stderr } = await runShellCommand(command, projectDir);

		if (code === 0) {
			return;
		}

		const output = [stdout, stderr].map(chunk => chunk.trim()).filter(Boolean).join('\n');

		log.error(`${prefix}Post-sync command exited with code ${code}${output ? `:\n${output}` : ''}`);
		window.showWarningMessage(`${prefix}Post-sync command failed — see the Murkvan output channel for details.`);
	}

	/** Restores this project's status once an install attempt of either kind settles. */
	function reportOutcome(outcome: NpmOutcome) {
		if (outcome === 'success') {
			packagesToInstall = [];
			setStatus('idle');
			return;
		}

		if (outcome === 'failed') {
			setStatus('error');
			return;
		}

		// Cancelling is not an error, so restore whatever was true before the run started.
		setStatus(packagesToInstall.length > 0 ? 'changes' : 'idle');
	}

	/**
	 * Installs exactly the packages `getDiff` flagged, each pinned to the
	 * version its diff names — the lockfile's own resolved version when the
	 * diff came from the fast lockfile-diffing path, since npm's
	 * `--no-package-lock` (or bun's `--no-save`) stops the manager from
	 * re-resolving it from a range.
	 *
	 * yarn and pnpm have no such flag on `add` — it always rewrites
	 * `package.json` — so `installArgs` returns `undefined` for them and only
	 * {@link reinstallAll} is offered.
	 */
	async function installPackages(): Promise<void> {
		if (packagesToInstall.length === 0) {
			window.showInformationMessage(`${prefix}Nothing to install — packages are in sync.`);
			return;
		}

		if (installation) {
			window.showWarningMessage(`${prefix}Packages are already syncing.`);
			return;
		}

		const args = packageManager.installArgs(packagesToInstall);

		if (!args) {
			window.showInformationMessage(
				`${prefix}${packageManager.id} always writes package.json when installing a package — use "Reinstall everything" instead.`
			);
			return;
		}

		const outcome = await runPackageManager(args, 'Packages syncing', packagesToInstall.length);

		reportOutcome(outcome);

		if (outcome === 'success') {
			await runPostSync();
		}
	}

	/**
	 * The sledgehammer: reinstalls the whole tree straight from the lockfile
	 * (`npm ci` and equivalents). Slower than {@link installPackages}, but the
	 * only way to also fix nested or duplicated dependencies a top-level diff
	 * can't see — and, for yarn and pnpm, the only install Murkvan offers at all.
	 */
	async function reinstallAll(): Promise<void> {
		if (installation) {
			window.showWarningMessage(`${prefix}Packages are already syncing.`);
			return;
		}

		const outcome = await runPackageManager(packageManager.reinstallArgs, 'Reinstalling all packages', undefined);

		reportOutcome(outcome);

		if (outcome === 'success') {
			await runPostSync();
		}
	}

	async function checkPackages(): Promise<void> {
		if (installation) {
			return;
		}

		setStatus('searching');

		const { diffs, error } = getDiff(projectDir, {
			includeDevDependencies: getSetting('includeDevDependencies', true),
		});

		if (error) {
			log.error(`${prefix}${DIFF_ERRORS[error]}`);
			setStatus('error');
			return;
		}

		packagesToInstall = getPackagesToInstall(diffs);

		if (packagesToInstall.length === 0) {
			log.info(`${prefix}Installed packages are in sync with package.json`);
			setStatus('idle');
			return;
		}

		diffs.forEach(diff => log.info(`${prefix}${describeDiff(diff)}`));
		setStatus('changes');

		// yarn and pnpm have no way to install specific packages without
		// rewriting package.json, so only a full reinstall is available.
		const canTargetInstall = packageManager.installArgs(packagesToInstall) !== undefined;

		if (getSetting('autoInstall', false)) {
			await (canTargetInstall ? installPackages() : reinstallAll());
			return;
		}

		const install = 'Install packages';
		const reinstall = 'Reinstall everything';
		const selection = await window.showInformationMessage(
			`${prefix}Changes detected: ${packagesToInstall.join(' • ')}`,
			...(canTargetInstall ? [install, reinstall] : [reinstall])
		);

		if (selection === install) {
			await installPackages();
		} else if (selection === reinstall) {
			await reinstallAll();
		}
	}

	async function onLockfileChanged(): Promise<void> {
		const currentHash = await hashFile(lockfilePath);
		const hashKey = currentHashKey();
		const previousHash = context.workspaceState.get<string>(hashKey);

		log.info(`${prefix}${lockfileName} hash: ${currentHash}`);

		if (currentHash === undefined || currentHash === previousHash) {
			return;
		}

		await context.workspaceState.update(hashKey, currentHash);
		await checkPackages();
	}

	function scheduleCheck(changedPath: string) {
		log.info(`${prefix}File changed: ${changedPath}`);

		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			void onLockfileChanged();
		}, CHANGE_DEBOUNCE_MS);
	}

	function watchArcStage(arcRoot: string) {
		const stagePath = path.join(arcRoot, '.arc', 'stage');

		const fileWatcher = chokidar.watch(stagePath, {
			persistent: true,
			ignoreInitial: true,
			followSymlinks: true,
			usePolling: true,
			interval: ARC_POLL_INTERVAL_MS,
		});

		fileWatcher.on('change', () => scheduleCheck(lockfilePath));
		fileWatcher.on('error', error => log.error(`${prefix}Arc watcher failed: ${String(error)}`));

		subscriptions.push({dispose: () => void fileWatcher.close()});
	}

	async function initialize(): Promise<void> {
		const lockfileHash = await hashFile(lockfilePath);

		await context.workspaceState.update(currentHashKey(), lockfileHash);
		log.info(`${prefix}Found ${lockfileName}: ${lockfilePath} (${packageManager.id})`);
		log.info(`${prefix}${lockfileName} hash: ${lockfileHash}`);
		setStatus('idle');

		const lockfileUri = vscode.Uri.file(lockfilePath);
		const workspaceFolder = workspace.getWorkspaceFolder(lockfileUri);
		// A RelativePattern keeps the watcher working on Windows, where a raw
		// absolute path is not a valid glob.
		const watchPattern = workspaceFolder
			? new vscode.RelativePattern(workspaceFolder, lockfileName)
			: lockfilePath;
		const lockfileWatcher = workspace.createFileSystemWatcher(watchPattern, true, false, true);

		lockfileWatcher.onDidChange(uri => scheduleCheck(uri.fsPath), null, subscriptions);
		subscriptions.push(lockfileWatcher);
		subscriptions.push({dispose: () => clearTimeout(debounceTimer)});

		const arcRoot = findArcRoot(projectDir);

		if (arcRoot) {
			log.info(`${prefix}Arc repository found: ${arcRoot}`);
			watchArcStage(arcRoot);
		}
	}

	return {
		projectDir,
		getStatus: () => status,
		getPendingPackages: () => packagesToInstall,
		initialize,
		checkPackages,
		installPackages,
		reinstallAll,
	};
}

export async function activate(context: vscode.ExtensionContext) {
	const { extension, subscriptions } = context;
	const extensionId = extension.packageJSON.name;
	const extensionName = extension.packageJSON.displayName;

	const projects: Project[] = [];

	const log = new Log();
	const statusBar = new StatusBar(extensionName);

	/** Recomputes the one shared status bar entry from every project's own state. */
	function refreshStatusBar() {
		const { status, packages } = aggregateStatus(projects.map(project => ({
			label: path.basename(project.projectDir),
			status: project.getStatus(),
			pendingPackages: project.getPendingPackages(),
		})));

		statusBar.updateStatus(status, packages);
	}

	/**
	 * Resolves which project a global install command should act on: the only
	 * one when there is just one — deferring to that project's own "nothing to
	 * install" check, same as before there was more than one project to pick
	 * from — or a picker across every known project when there are several.
	 * `reinstallAll` has no pending-diff precondition of its own (it fixes
	 * drift a diff can't see at all), so the picker always lists every
	 * project rather than only the ones currently flagged as out of sync.
	 */
	async function resolveTargetProject(): Promise<Project | undefined> {
		if (projects.length === 0) {
			window.showInformationMessage('Nothing to install — packages are in sync.');
			return undefined;
		}

		if (projects.length === 1) {
			return projects[0];
		}

		const picked = await window.showQuickPick(
			projects.map(project => ({
				label: path.basename(project.projectDir),
				description: project.getPendingPackages().length > 0
					? `${project.getPendingPackages().length} package(s) out of sync`
					: 'in sync',
				project,
			})),
			{ placeHolder: 'Choose which project to sync' }
		);

		return picked?.project;
	}

	// Commands are registered before project discovery so they always resolve,
	// even in a workspace Murkvan cannot watch.
	subscriptions.push(
		statusBar,
		log,
		commands.registerCommand(`${extensionId}.showOutputChannel`, () => log.show()),
		commands.registerCommand(`${extensionId}.installPackages`, async () => {
			await (await resolveTargetProject())?.installPackages();
		}),
		commands.registerCommand(`${extensionId}.checkPackages`, async () => {
			if (projects.length === 0) {
				log.error('No supported lockfile found — nothing to compare');
				statusBar.updateStatus('error');
				return;
			}

			for (const project of projects) {
				await project.checkPackages();
			}
		}),
		commands.registerCommand(`${extensionId}.reinstallAll`, async () => {
			await (await resolveTargetProject())?.reinstallAll();
		}),
	);

	/**
	 * Finds every lockfile in the workspace and initializes a project for
	 * each one. A workspace can hold more than one project — a genuine
	 * multi-root workspace, or an unrelated sub-project in its own folder —
	 * so every lockfile is gathered and grouped by directory instead of only
	 * the first one found winning.
	 *
	 * Safe to call more than once: it only ever adds projects, and a repeat
	 * call that finds nothing new is a no-op.
	 */
	async function discoverProjects(): Promise<void> {
		const matches = await workspace.findFiles(`{${ALL_LOCKFILE_NAMES.join(',')}}`, LOCKFILE_SEARCH_EXCLUDE);
		const projectLockfiles = groupLockfilesByProject(matches.map(uri => uri.fsPath))
			.filter(lockfilePath => !projects.some(project => project.projectDir === path.dirname(lockfilePath)));

		if (projects.length === 0 && projectLockfiles.length === 0) {
			log.error('No supported lockfile found');
			statusBar.updateStatus('error');
			return;
		}

		const isMultiRoot = projects.length + projectLockfiles.length > 1;

		for (const lockfilePath of projectLockfiles) {
			const label = isMultiRoot ? path.basename(path.dirname(lockfilePath)) : undefined;
			const project = createProject(context, lockfilePath, label, refreshStatusBar, log);

			projects.push(project);
			await project.initialize();
		}

		refreshStatusBar();
	}

	await discoverProjects();

	// Without a lockfile there is nothing to watch yet — a fresh `git clone`,
	// or a workspace opened before `npm install` has ever run. Rather than
	// staying inert until the window is reloaded, watch for one of the
	// supported lockfiles being created anywhere and try discovery again;
	// once it finds a project, this watcher has done its job and stops.
	if (projects.length === 0) {
		log.info('Watching for a supported lockfile to be created...');

		const creationWatcher = workspace.createFileSystemWatcher(`{${ALL_LOCKFILE_NAMES.join(',')}}`, false, true, true);
		let debounceTimer: NodeJS.Timeout | undefined;

		const onCreate = creationWatcher.onDidCreate(() => {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				void (async () => {
					await discoverProjects();

					if (projects.length > 0) {
						onCreate.dispose();
						creationWatcher.dispose();
					}
				})();
			}, CHANGE_DEBOUNCE_MS);
		});

		subscriptions.push(creationWatcher, onCreate, { dispose: () => clearTimeout(debounceTimer) });
	}
}

export function deactivate() {}
