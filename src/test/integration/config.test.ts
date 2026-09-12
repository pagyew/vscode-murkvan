import assert from 'node:assert';
import { getSetting } from '../../config';

suite('getSetting', () => {
	test('reads the defaults contributed by package.json', () => {
		assert.strictEqual(getSetting('logLevel', 'off'), 'info');
		assert.strictEqual(getSetting('showOutputOnError', true), false);
		assert.strictEqual(getSetting('includeDevDependencies', false), true);
		assert.strictEqual(getSetting('autoInstall', true), false);
	});

	test('falls back for an unknown setting', () => {
		assert.strictEqual(getSetting('notASetting', 'fallback'), 'fallback');
	});
});
