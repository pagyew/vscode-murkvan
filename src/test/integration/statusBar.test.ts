import assert from 'node:assert';
import * as vscode from 'vscode';
import { StatusBar } from '../../statusBar';

const EXTENSION_NAME = 'Murkvan';

suite('StatusBar', () => {
	// A fresh instance per test — instead of one module-level singleton shared
	// across the whole suite — is the point of this class: no state to leak
	// between tests that run in the same process.
	let statusBar: StatusBar;

	setup(() => { statusBar = new StatusBar(EXTENSION_NAME); });
	teardown(() => statusBar.dispose());

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

	// Two instances at once — the situation a multi-root workspace or a
	// second test both create — must not share or clobber each other's item.
	test('keeps two instances independent', () => {
		const other = new StatusBar('Other');

		try {
			statusBar.updateStatus('changes', ['a@1.0.0']);
			other.updateStatus('idle');

			assert.notStrictEqual(statusBar.get(), other.get());
			assert.strictEqual(other.get()?.text, 'Other: $(eye)');
		} finally {
			other.dispose();
		}
	});

	test('ignores updates after disposal', () => {
		statusBar.dispose();
		statusBar.updateStatus('idle');

		assert.strictEqual(statusBar.get(), undefined);
	});
});
