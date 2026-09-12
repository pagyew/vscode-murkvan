import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import vscode from 'vscode';
import chokidar from 'chokidar';
import log from './log';
import statusBar from './statusBar';
import { getSetting } from './config';
import { getDiff, getPackagesToInstall, type DiffError, type PackageDiff } from './getDiff';
import { hashFile } from './hash';
import { findArcRoot } from './vcs';

const {window, workspace, commands} = vscode;

const PACKAGE_LOCK_FILENAME = 'package-lock.json';
const PACKAGE_LOCK_HASH_KEY = 'packageLockHash';
/** Git and npm rewrite the lockfile in bursts; collapse them into one check. */
const CHANGE_DEBOUNCE_MS = 300;
/** Arc mounts its store over FUSE, where native watchers stay silent. */
const ARC_POLL_INTERVAL_MS = 1_000;
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const DIFF_ERRORS: Record<DiffError, string> = {
	'manifest-not-found': 'package.json not found',
	'manifest-unreadable': 'package.json could not be parsed',
	'node-modules-not-found': 'node_modules not found — install dependencies once before Murkvan can compare them',
};

function describeDiff({packageName, declaredVersion, installedVersion, diffType, changeDirection}: PackageDiff) {
	const declared = declaredVersion ?? 'not declared';
	const installed = installedVersion ?? 'not installed';
	const direction = changeDirection === 'unknown' ? '' : `, ${changeDirection}`;

	return `${packageName}: declared ${declared}, installed ${installed} (${diffType}${direction})`;
}

export async function activate(context: vscode.ExtensionContext) {
	const { extension, subscriptions } = context;
	const extensionId = extension.packageJSON.name;
	const extensionName = extension.packageJSON.displayName;

	let packagesToInstall: string[] = [];
	let projectDir = '';
	let installation: ChildProcess | undefined;
	let debounceTimer: NodeJS.Timeout | undefined;

	statusBar.activate(extensionName);

	type NpmOutcome = 'success' | 'cancelled' | 'failed';

	/** Spawns `npm <args>` under a cancellable progress notification. */
	async function runNpm(args: string[], cwd: string, progressTitle: string): Promise<NpmOutcome> {
		statusBar.updateStatus('syncing');

		log.info(`Run command "npm ${args.join(' ')}"`);

		return window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: progressTitle,
			cancellable: true
		}, (progress, token) => new Promise<NpmOutcome>(resolve => {
			const npm = spawn(NPM_COMMAND, args, { cwd, windowsHide: true });
			let cancelled = false;
			let stderr = '';

			installation = npm;

			npm.stderr?.on('data', chunk => { stderr += chunk.toString(); });

			token.onCancellationRequested(() => {
				cancelled = true;
				npm.kill();
			});

			npm.on('error', error => {
				log.error(`Failed to run npm: ${error.message}`);
			});

			npm.on('close', code => {
				installation = undefined;

				if (cancelled) {
					log.info('Packages sync cancelled!');
					window.showInformationMessage('Packages sync cancelled!');
					resolve('cancelled');
					return;
				}

				if (code === 0) {
					log.info('Packages synced!');
					window.showInformationMessage('Packages synced!');
					resolve('success');
					return;
				}

				statusBar.updateStatus('error');
				log.error(`npm exited with code ${code}${stderr ? `:\n${stderr.trim()}` : ''}`);
				window.showErrorMessage('Packages sync failed!');
				resolve('failed');
			});
		}));
	}

	/** Restores the status bar once an install attempt of either kind settles. */
	function reportOutcome(outcome: NpmOutcome) {
		if (outcome === 'success') {
			packagesToInstall = [];
			statusBar.updateStatus('idle');
			return;
		}

		// A 'failed' run already left the status bar on 'error'; cancelling is
		// not an error, so restore whatever was true before the run started.
		if (outcome === 'cancelled') {
			if (packagesToInstall.length > 0) {
				statusBar.updateStatus('changes', packagesToInstall);
			} else {
				statusBar.updateStatus('idle');
			}
		}
	}

	/**
	 * Installs exactly the packages `getDiff` flagged, each pinned to the
	 * version its diff names — the lockfile's own resolved version when the
	 * diff came from the fast lockfile-diffing path, since `--no-package-lock`
	 * stops npm from re-resolving it from a range.
	 */
	async function installPackages(packages: string[], cwd: string) {
		if (packages.length === 0 || cwd === '') {
			window.showInformationMessage('Nothing to install — packages are in sync.');
			return;
		}

		if (installation) {
			window.showWarningMessage('Packages are already syncing.');
			return;
		}

		reportOutcome(await runNpm(['i', '--no-package-lock', '--no-save', ...packages], cwd, 'Packages syncing'));
	}

	/**
	 * The sledgehammer: `npm ci` wipes `node_modules` and reinstalls the whole
	 * tree from the lockfile. Slower than {@link installPackages}, but the
	 * only way to also fix nested or duplicated dependencies a top-level diff
	 * can't see.
	 */
	async function reinstallAll(cwd: string) {
		if (cwd === '') {
			window.showInformationMessage('Nothing to install — packages are in sync.');
			return;
		}

		if (installation) {
			window.showWarningMessage('Packages are already syncing.');
			return;
		}

		reportOutcome(await runNpm(['ci'], cwd, 'Reinstalling all packages'));
	}

	async function checkPackages() {
		if (installation) {
			return;
		}

		// Without a lockfile there is no project root, and a relative lookup
		// would resolve against the extension host's working directory.
		if (projectDir === '') {
			log.error(`No ${PACKAGE_LOCK_FILENAME} found — nothing to compare`);
			statusBar.updateStatus('error');
			return;
		}

		statusBar.updateStatus('searching');

		const { diffs, error } = getDiff(projectDir, {
			includeDevDependencies: getSetting('includeDevDependencies', true),
		});

		if (error) {
			log.error(DIFF_ERRORS[error]);
			statusBar.updateStatus('error');
			return;
		}

		packagesToInstall = getPackagesToInstall(diffs);

		if (packagesToInstall.length === 0) {
			log.info('Installed packages are in sync with package.json');
			statusBar.updateStatus('idle');
			return;
		}

		diffs.forEach(diff => log.info(describeDiff(diff)));
		statusBar.updateStatus('changes', packagesToInstall);

		if (getSetting('autoInstall', false)) {
			await installPackages(packagesToInstall, projectDir);
			return;
		}

		const install = 'Install packages';
		const reinstall = 'Reinstall everything';
		const selection = await window.showInformationMessage(
			`Changes detected: ${packagesToInstall.join(' • ')}`,
			install,
			reinstall
		);

		if (selection === install) {
			await installPackages(packagesToInstall, projectDir);
		} else if (selection === reinstall) {
			await reinstallAll(projectDir);
		}
	}

	async function onLockfileChanged(lockfilePath: string) {
		const currentHash = await hashFile(lockfilePath);
		const previousHash = context.workspaceState.get<string>(PACKAGE_LOCK_HASH_KEY);

		log.info(`${PACKAGE_LOCK_FILENAME} hash: ${currentHash}`);

		if (currentHash === undefined || currentHash === previousHash) {
			return;
		}

		await context.workspaceState.update(PACKAGE_LOCK_HASH_KEY, currentHash);
		await checkPackages();
	}

	function scheduleCheck(lockfilePath: string) {
		log.info(`File changed: ${lockfilePath}`);

		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			void onLockfileChanged(lockfilePath);
		}, CHANGE_DEBOUNCE_MS);
	}

	function watchArcStage(arcRoot: string, lockfilePath: string) {
		const stagePath = path.join(arcRoot, '.arc', 'stage');

		const fileWatcher = chokidar.watch(stagePath, {
			persistent: true,
			ignoreInitial: true,
			followSymlinks: true,
			usePolling: true,
			interval: ARC_POLL_INTERVAL_MS,
		});

		fileWatcher.on('change', () => scheduleCheck(lockfilePath));
		fileWatcher.on('error', error => log.error(`Arc watcher failed: ${String(error)}`));

		subscriptions.push({dispose: () => void fileWatcher.close()});
	}

	// Commands are registered before the lockfile lookup so they always resolve,
	// even in a workspace Murkvan cannot watch.
	subscriptions.push(
		statusBar,
		log,
		{dispose: () => clearTimeout(debounceTimer)},
		commands.registerCommand(`${extensionId}.showOutputChannel`, () => log.show()),
		commands.registerCommand(`${extensionId}.installPackages`, () => installPackages(packagesToInstall, projectDir)),
		commands.registerCommand(`${extensionId}.checkPackages`, () => checkPackages()),
		commands.registerCommand(`${extensionId}.reinstallAll`, () => reinstallAll(projectDir)),
	);

	const [packageLockFile] = await workspace.findFiles(PACKAGE_LOCK_FILENAME, null, 1);

	if (!packageLockFile) {
		log.error(`No ${PACKAGE_LOCK_FILENAME} found`);
		statusBar.updateStatus('error');
		return;
	}

	const lockfilePath = packageLockFile.fsPath;

	projectDir = path.dirname(lockfilePath);
	log.info(`Found ${PACKAGE_LOCK_FILENAME}: ${lockfilePath}`);

	const packageLockHash = await hashFile(lockfilePath);

	await context.workspaceState.update(PACKAGE_LOCK_HASH_KEY, packageLockHash);
	log.info(`${PACKAGE_LOCK_FILENAME} hash: ${packageLockHash}`);
	statusBar.updateStatus('idle');

	const workspaceFolder = workspace.getWorkspaceFolder(packageLockFile);
	// A RelativePattern keeps the watcher working on Windows, where a raw
	// absolute path is not a valid glob.
	const watchPattern = workspaceFolder
		? new vscode.RelativePattern(workspaceFolder, PACKAGE_LOCK_FILENAME)
		: lockfilePath;
	const packageLockWatcher = workspace.createFileSystemWatcher(watchPattern, true, false, true);

	packageLockWatcher.onDidChange(uri => scheduleCheck(uri.fsPath), null, subscriptions);
	subscriptions.push(packageLockWatcher);

	const arcRoot = findArcRoot(projectDir);

	if (arcRoot) {
		log.info(`Arc repository found: ${arcRoot}`);
		watchArcStage(arcRoot, lockfilePath);
	}
}

export function deactivate() {}
