import {spawnSync} from 'node:child_process';
import log from './log';
import path from 'node:path';
import statusBar from "./statusBar";
import vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	statusBar.activate();

	const watcher = vscode.workspace.createFileSystemWatcher('**/package-lock.json');

	log.info("Watching package lock file");

	const listener = (uri: vscode.Uri) => {
		statusBar.update({
			icon: "loading",
			tooltip: `Running \`npm ci\`...`,
		});
		
		const dir = path.dirname(uri.fsPath);
		log.info(`Command: \`npm ci\` / Options: ${JSON.stringify({cwd: dir})}`);
		const npmi = spawnSync('npm', ['ci'], {cwd: dir});
		
		log.info(`Command output: ${npmi.output.join('\n')}`);

		statusBar.update({
      icon: "check-all",
      tooltip: "Watching package lock file",
    });
	};
	
	watcher.onDidChange(listener);

	const logger = vscode.commands.registerCommand("packages-syncer.showOutputChannel", () => {
		log.show();
	});

	context.subscriptions.push(
		logger,
		statusBar,
		watcher
	);
}

export function deactivate() {}
