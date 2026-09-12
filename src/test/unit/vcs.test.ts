import assert from 'node:assert';
import os from 'node:os';
import { findArcRoot, parseArcRoot } from '../../vcs';

suite('parseArcRoot', () => {
	test('trims the reported root', () => {
		assert.strictEqual(parseArcRoot({ status: 0, stdout: '/home/user/arcadia\n' }), '/home/user/arcadia');
	});

	test('ignores a failed lookup', () => {
		assert.strictEqual(parseArcRoot({ status: 1, stdout: '' }), undefined);
	});

	test('ignores a command that could not be spawned', () => {
		assert.strictEqual(parseArcRoot({ error: new Error('spawn ENOENT'), status: null, stdout: '' }), undefined);
	});

	test('ignores empty output', () => {
		assert.strictEqual(parseArcRoot({ status: 0, stdout: '\n' }), undefined);
	});
});

suite('findArcRoot', () => {
	// Regression: Arc detection used to run `command -v arc`, a shell builtin
	// that spawnSync cannot execute, so the probe never succeeded.
	test('returns undefined when the binary is missing, without throwing', () => {
		assert.strictEqual(findArcRoot(os.tmpdir(), 'murkvan-missing-binary'), undefined);
	});
});
