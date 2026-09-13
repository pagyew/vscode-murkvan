import assert from 'node:assert';
import os from 'node:os';
import { findArcRoot, getCurrentBranch, parseArcRoot, parseBranch } from '../../vcs';

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

suite('parseBranch', () => {
	test('trims the reported branch', () => {
		assert.strictEqual(parseBranch({ status: 0, stdout: 'main\n' }), 'main');
	});

	test('treats a detached HEAD as its own pseudo-branch', () => {
		assert.strictEqual(parseBranch({ status: 0, stdout: 'HEAD\n' }), 'HEAD');
	});

	test('ignores a failed lookup', () => {
		assert.strictEqual(parseBranch({ status: 128, stdout: '' }), undefined);
	});

	test('ignores a command that could not be spawned', () => {
		assert.strictEqual(parseBranch({ error: new Error('spawn ENOENT'), status: null, stdout: '' }), undefined);
	});

	test('ignores empty output', () => {
		assert.strictEqual(parseBranch({ status: 0, stdout: '\n' }), undefined);
	});
});

suite('getCurrentBranch', () => {
	test('returns undefined when the binary is missing, without throwing', () => {
		assert.strictEqual(getCurrentBranch(os.tmpdir(), 'murkvan-missing-binary'), undefined);
	});

	test('returns undefined outside of a repository', () => {
		assert.strictEqual(getCurrentBranch(os.tmpdir()), undefined);
	});

	// This suite itself runs from inside a real Git checkout, so the real
	// `git` binary is exercised end to end rather than mocked.
	test('resolves the branch of the repository this suite runs in', () => {
		const branch = getCurrentBranch(__dirname);

		assert.ok(typeof branch === 'string' && branch.length > 0);
	});
});
