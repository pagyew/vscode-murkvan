import assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'pagyew.murkvan';
const EXPECTED_COMMANDS = [
	'murkvan.showOutputChannel',
	'murkvan.installPackages',
	'murkvan.checkPackages',
];

suite('extension', () => {
	test('is installed in the test host', () => {
		assert.ok(vscode.extensions.getExtension(EXTENSION_ID));
	});

	// Regression: activation used to build a file watcher from the lockfile it
	// had just failed to find, throwing before any command was registered.
	test('activates in a workspace without a lockfile', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);

		assert.ok(extension);
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	test('registers every contributed command', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)?.activate();

		const registered = await vscode.commands.getCommands(true);

		for (const command of EXPECTED_COMMANDS) {
			assert.ok(registered.includes(command), `command "${command}" is not registered`);
		}
	});

	test('contributes the commands it registers', () => {
		const contributed: Array<{ command: string }> =
			vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.contributes.commands ?? [];

		assert.deepStrictEqual(contributed.map(({ command }) => command).sort(), [...EXPECTED_COMMANDS].sort());
	});

	test('installPackages reports nothing to do instead of failing', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
		await vscode.commands.executeCommand('murkvan.installPackages');
	});

	// Without a lockfile there is no project root; the check must not fall back
	// to the extension host's working directory.
	test('checkPackages is a no-op without a lockfile', async () => {
		await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
		await vscode.commands.executeCommand('murkvan.checkPackages');
	});
});
