import assert from 'node:assert';
import * as vscode from 'vscode';
import statusBar from '../../statusBar';

const EXTENSION_NAME = 'Murkvan';

suite('statusBar', () => {
	suiteSetup(() => statusBar.activate(EXTENSION_NAME));
	suiteTeardown(() => statusBar.dispose());

	test('shows an icon for every status', () => {
		const icons: Record<string, string> = {
			idle: 'eye',
			searching: 'loading~spin',
			syncing: 'sync~spin',
			error: 'error',
		};

		for (const [status, icon] of Object.entries(icons)) {
			statusBar.updateStatus(status as 'idle');
			assert.strictEqual(statusBar.get()?.text, `${EXTENSION_NAME}: $(${icon})`);
		}
	});

	test('lists pending packages in a trusted tooltip', () => {
		statusBar.updateStatus('changes', ['lodash@^4.17.0']);

		const item = statusBar.get();
		const tooltip = item?.tooltip as vscode.MarkdownString;

		assert.ok(tooltip instanceof vscode.MarkdownString);
		assert.match(tooltip.value, /lodash@\^4\.17\.0/);
		assert.deepStrictEqual(tooltip.isTrusted, { enabledCommands: ['murkvan.installPackages'] });
		assert.strictEqual((item?.backgroundColor as vscode.ThemeColor).id, 'statusBarItem.warningBackground');
	});

	// VS Code accepts only warningBackground and errorBackground here, so the
	// warning has to be cleared with undefined rather than another ThemeColor.
	test('clears the warning background once the changes are handled', () => {
		statusBar.updateStatus('changes', ['lodash@^4.17.0']);
		statusBar.updateStatus('idle');

		const item = statusBar.get();

		assert.strictEqual(item?.backgroundColor, undefined);
		assert.strictEqual(typeof item?.tooltip, 'string');
	});

	// Regression: activate() used to overwrite the item it already owned.
	test('replaces its item on re-activation instead of leaking one', () => {
		const first = statusBar.get();

		statusBar.activate(EXTENSION_NAME);

		assert.notStrictEqual(statusBar.get(), first);
	});

	test('ignores updates after disposal', () => {
		statusBar.dispose();
		statusBar.updateStatus('idle');

		assert.strictEqual(statusBar.get(), undefined);

		statusBar.activate(EXTENSION_NAME);
	});
});
