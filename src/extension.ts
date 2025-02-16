import { spawn, spawnSync } from 'node:child_process';
import log from './log';
import path from 'node:path';
import vscode from 'vscode';
import chokidar from 'chokidar';

const {Created, Changed, Deleted} = vscode.FileChangeType;
const {window, workspace, commands} = vscode;

const PACKAGE_FILENAME = 'package.json';
const PACKAGE_LOCK_FILENAME = 'package-lock.json';

let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
	const { extension, subscriptions } = context;
	const extensionId = extension.packageJSON.name;
	const extensionName = extension.packageJSON.displayName;
	const showOutputChannelCommand = `${extensionId}.showOutputChannel`;

	const [packageFile] = await workspace.findFiles(PACKAGE_FILENAME, null, 1);
	const [packageLockFile] = await workspace.findFiles(PACKAGE_LOCK_FILENAME, null, 1);

	if (!packageFile) {
		log.error('No package.json found');
	}

	if (!packageLockFile) {
		log.error('No package-lock.json found');
	}

	statusBar = window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	statusBar.command = showOutputChannelCommand;
	statusBar.text = `${extensionName}: $(eye)`;
	statusBar.tooltip = 'Watching package-lock.json';

	const packageWatcher = workspace.createFileSystemWatcher(packageFile.fsPath);
	const packageLockWatcher = workspace.createFileSystemWatcher(packageLockFile.fsPath);
	const watchers = [packageWatcher];

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

		statusBar.text = `${extensionName}: $(sync~spin)`;
		statusBar.tooltip = 'Syncing packages...';

		let progressResolver = (value?: unknown) => {};

		window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Packages Syncing',
			cancellable: false
		}, () => {
			return new Promise((res) => {
				progressResolver = res;
			});
		});

		const dir = path.dirname(uri.fsPath);
		let command = 'ci';

		if (type === Created) {
			command = 'i';
		}
		
		const npmi = spawn('npm', [command], { cwd: dir });

		npmi.on('exit', (code) => {
			progressResolver();
			
			if (code === 0) {
				window.showInformationMessage('Packages synced!');
			} else {
				window.showErrorMessage('Packages sync failed!');	
			}
		});

		npmi.on('error', () => {
			window.showErrorMessage('Packages sync failed!');	
		});

		npmi.on('close', () => {
			statusBar.text = `${extensionName}: $(eye)`;
			statusBar.tooltip = 'Watching package-lock.json';
		});
	};

	watchers.forEach((watcher) => {
		watcher.onDidCreate(createListener, null, subscriptions);
		watcher.onDidChange(changeListener, null, subscriptions);
		watcher.onDidDelete(deleteListener, null, subscriptions);
	});

	if (spawnSync('command', ['-v', 'arc']).status === 0) {

		window.showInformationMessage('Arc found!');

		const arcRootCommand = spawnSync('arc', ['root'], { cwd: path.dirname(packageFile.fsPath)});
		const arcRoot = arcRootCommand.stdout.toString().replaceAll('\n', '');
		const stagePath = path.join(arcRoot, '.arc', 'stage');
		
		const fileWatcher = chokidar.watch(stagePath, {
				persistent: true,
				ignoreInitial: true,
				followSymlinks: true,
				usePolling: true,
		});
	
		fileWatcher.on('change', () => changeListener(packageFile));

		subscriptions.push({dispose: fileWatcher.close});
	}

	const logger = commands.registerCommand(showOutputChannelCommand, () => log.show());

	subscriptions.push(
		statusBar,
		logger
	);

	statusBar.show();
}

export function deactivate() {}
