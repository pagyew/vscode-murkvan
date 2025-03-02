import { spawn, spawnSync } from 'node:child_process';
import log from './log';
import statusBar from './statusBar';
import path from 'node:path';
import vscode from 'vscode';
import chokidar from 'chokidar';

const {Created, Changed, Deleted} = vscode.FileChangeType;
const {window, workspace, commands} = vscode;

const PACKAGE_LOCK_FILENAME = 'package-lock.json';

function getMD5Hash(filePath: string) {
	const md5Command = spawnSync('md5', [filePath]);
	return md5Command.stdout.toString().split('=')[1].trim();
}

export async function activate(context: vscode.ExtensionContext) {
	const { extension, subscriptions } = context;
	const extensionId = extension.packageJSON.name;
	const extensionName = extension.packageJSON.displayName;
	const showOutputChannelCommand = `${extensionId}.showOutputChannel`;

	statusBar.activate(extensionName);

	const [packageLockFile] = await workspace.findFiles(PACKAGE_LOCK_FILENAME, null, 1);

	if (packageLockFile) {
		log.info(`Found package-lock.json: ${packageLockFile.fsPath}`);
	} else {
		log.error('No package-lock.json found');
	}

	const packageLockHash = getMD5Hash(packageLockFile.fsPath);

	context.workspaceState.update('packageLockHash', packageLockHash);

	log.info(`package-lock.json hash: ${packageLockHash}`);

	statusBar.updateStatus('idle');

	const packageLockWatcher = workspace.createFileSystemWatcher(packageLockFile.fsPath);
	const watchers = [packageLockWatcher];

	function createListener(uri: vscode.Uri) {
		log.info(`File created: ${uri.fsPath}`);
		listener(uri, Created);
	};
	
	function changeListener(uri: vscode.Uri) {
		log.info(`File changed: ${uri.fsPath}`);
		listener(uri, Changed);
	};

	function deleteListener(uri: vscode.Uri) {
		log.info(`File deleted: ${uri.fsPath}`);
		listener(uri, Deleted);
	};

	function listener(uri: vscode.Uri, type: vscode.FileChangeType) {
		if (type === Deleted) {
			return;
		}

		const currentHash = getMD5Hash(packageLockFile.fsPath);
		const previousHash = context.workspaceState.get('packageLockHash');

		log.info(`package-lock.json hash: ${currentHash}`);
		
		if (currentHash === previousHash) {
			return;
		}

		context.workspaceState.update('packageLockHash', currentHash);
		statusBar.updateStatus('syncing');

		let progressResolver = (...args: any) => {};
		let progressCanceller = (...args: any) => {};

		window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Packages syncing',
			cancellable: true
		}, (progress, token) => {
			token.onCancellationRequested(() => progressCanceller());

			return new Promise(resolver => {
				progressResolver = resolver;
			});
		});

		const dir = path.dirname(uri.fsPath);
		let command = 'ci';

		if (type === Created) {
			command = 'i';
		}
		
		const npmi = spawn('npm', [command], { cwd: dir });

		progressCanceller = () => {
			npmi.kill();
			statusBar.updateStatus('idle');
			log.info('Packages sync cancelled!');
			window.showInformationMessage('Packages sync cancelled!');
		};

		npmi.on('exit', (code) => {
			progressResolver();
			
			if (code === 0) {
				window.showInformationMessage('Packages synced!');
			}
		});

		npmi.on('error', () => {
			window.showErrorMessage('Packages sync failed!');
			statusBar.updateStatus('error');
		});

		npmi.on('close', () => {
			statusBar.updateStatus('idle');
		});
	};

	watchers.forEach((watcher) => {
		watcher.onDidCreate(createListener, null, subscriptions);
		watcher.onDidChange(changeListener, null, subscriptions);
		watcher.onDidDelete(deleteListener, null, subscriptions);
	});

	if (spawnSync('command', ['-v', 'arc']).status === 0) {
		window.showInformationMessage('Arc found!');

		const arcRootCommand = spawnSync('arc', ['root'], { cwd: path.dirname(packageLockFile.fsPath)});
		const arcRoot = arcRootCommand.stdout.toString().replaceAll('\n', '');
		const stagePath = path.join(arcRoot, '.arc', 'stage');
		
		const fileWatcher = chokidar.watch(stagePath, {
				persistent: true,
				ignoreInitial: true,
				followSymlinks: true,
				usePolling: true,
		});
	
		fileWatcher.on('change', () => changeListener(packageLockFile));

		subscriptions.push({dispose: fileWatcher.close});
	}

	const logger = commands.registerCommand(showOutputChannelCommand, () => log.show());

	subscriptions.push(
		statusBar,
		logger
	);
}

export function deactivate() {}
