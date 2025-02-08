import { spawn } from 'node:child_process';
import log from './log';
import path from 'node:path';
import vscode from 'vscode';

let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	const { extension, subscriptions } = context;
	const extensionId = extension.packageJSON.name;
	const extensionName = extension.packageJSON.displayName;
	const showOutputChannelCommand = `${extensionId}.showOutputChannel`;


	statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	statusBar.command = showOutputChannelCommand;
	statusBar.text = `${extensionName}: $(eye)`;
	statusBar.tooltip = 'Watching package-lock.json';

	const watcher = vscode.workspace.createFileSystemWatcher('**/package-lock.json');

	const listener = (uri: vscode.Uri) => {
		statusBar.text = `${extensionName}: $(sync~spin)`;
		statusBar.tooltip = 'Syncing packages...';

		let progressResolver = (value?: unknown) => {};

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Packages Syncing',
			cancellable: false
		}, () => {
			return new Promise((res) => {
				progressResolver = res;
			});
		});

		const dir = path.dirname(uri.fsPath);
		const npmi = spawn('npm', ['ci'], { cwd: dir });

		npmi.stdout.on('data', () => {
			progressResolver();
			
			statusBar.text = `${extensionName}: $(eye)`;
			statusBar.tooltip = 'Watching package-lock.json';

			vscode.window.showInformationMessage('Packages synced!');
		});
	};

	watcher.onDidChange(listener);

	const logger = vscode.commands.registerCommand(showOutputChannelCommand, () => log.show());

	subscriptions.push(
		statusBar,
		logger,
		watcher
	);

	statusBar.show();
}

export function deactivate() { }
