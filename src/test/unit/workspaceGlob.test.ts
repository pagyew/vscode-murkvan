import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspacePattern } from '../../workspaceGlob';
import { createProject, removeProjects } from '../helpers/fixtures';

function mkdir(root: string, relativePath: string): string {
	const dir = path.join(root, relativePath);

	fs.mkdirSync(dir, { recursive: true });

	return dir;
}

suite('resolveWorkspacePattern', () => {
	teardown(removeProjects);

	test('resolves a literal path without a glob, whether or not it exists', () => {
		const root = createProject({ manifest: {} });

		assert.deepStrictEqual(resolveWorkspacePattern(root, 'apps/api'), [path.join(root, 'apps', 'api')]);
	});

	test('expands a single trailing "*" to every immediate subdirectory', () => {
		const root = createProject({ manifest: {} });
		const app = mkdir(root, 'packages/app');
		const lib = mkdir(root, 'packages/lib');

		fs.writeFileSync(path.join(root, 'packages', 'README.md'), '');

		const resolved = resolveWorkspacePattern(root, 'packages/*').sort();

		assert.deepStrictEqual(resolved, [app, lib].sort());
	});

	test('expands a bare "*" against the project root itself', () => {
		const root = createProject({ manifest: {}, nodeModules: false });
		const app = mkdir(root, 'app');

		assert.deepStrictEqual(resolveWorkspacePattern(root, '*'), [app]);
	});

	test('returns nothing for a directory that does not exist', () => {
		const root = createProject({ manifest: {} });

		assert.deepStrictEqual(resolveWorkspacePattern(root, 'packages/*'), []);
	});

	// Regression: these shapes must be skipped, not mis-resolved into the
	// wrong directories or throw.
	test('skips patterns needing more than a single trailing "*"', () => {
		const root = createProject({ manifest: {} });

		mkdir(root, 'packages/nested/app');

		assert.deepStrictEqual(resolveWorkspacePattern(root, 'packages/**'), []);
		assert.deepStrictEqual(resolveWorkspacePattern(root, 'pkg-*'), []);
		assert.deepStrictEqual(resolveWorkspacePattern(root, '*/nested'), []);
	});
});
