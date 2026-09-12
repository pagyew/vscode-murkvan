import assert from 'node:assert';
import path from 'node:path';
import { hashFile } from '../../hash';
import { createProject, removeProjects, writeFile } from '../helpers/fixtures';

suite('hashFile', () => {
	teardown(removeProjects);

	test('is stable for the same contents', async () => {
		const root = createProject({ nodeModules: false });
		const first = writeFile(root, 'a/package-lock.json', '{"lockfileVersion":3}');
		const second = writeFile(root, 'b/package-lock.json', '{"lockfileVersion":3}');

		assert.strictEqual(await hashFile(first), await hashFile(second));
	});

	test('changes when the contents change', async () => {
		const root = createProject({ nodeModules: false });
		const lockfile = writeFile(root, 'package-lock.json', '{"lockfileVersion":3}');
		const before = await hashFile(lockfile);

		writeFile(root, 'package-lock.json', '{"lockfileVersion":3,"packages":{}}');

		assert.notStrictEqual(before, await hashFile(lockfile));
	});

	test('hashes an empty file', async () => {
		const root = createProject({ nodeModules: false });

		assert.strictEqual(typeof await hashFile(writeFile(root, 'empty', '')), 'string');
	});

	// Regression: hashing used to shell out to macOS-only `md5` and threw on
	// every other platform.
	test('returns undefined instead of throwing for an unreadable file', async () => {
		const root = createProject({ nodeModules: false });

		assert.strictEqual(await hashFile(path.join(root, 'does-not-exist.json')), undefined);
		assert.strictEqual(await hashFile(root), undefined);
	});
});
