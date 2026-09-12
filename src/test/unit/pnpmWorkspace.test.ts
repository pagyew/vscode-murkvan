import assert from 'node:assert';
import path from 'node:path';
import { parsePnpmWorkspacePackages, resolvePnpmWorkspaceMembers } from '../../pnpmWorkspace';
import { createProject, removeProjects, writeFile } from '../helpers/fixtures';

suite('parsePnpmWorkspacePackages', () => {
	test('parses a block sequence', () => {
		const yaml = [
			'packages:',
			"  - 'packages/*'",
			"  - 'apps/*'",
		].join('\n');

		assert.deepStrictEqual(parsePnpmWorkspacePackages(yaml), ['packages/*', 'apps/*']);
	});

	test('parses a flow sequence on the key\'s own line', () => {
		assert.deepStrictEqual(
			parsePnpmWorkspacePackages("packages: ['packages/*', 'apps/*']"),
			['packages/*', 'apps/*'],
		);
	});

	test('accepts unquoted block-sequence items', () => {
		const yaml = ['packages:', '  - packages/*'].join('\n');

		assert.deepStrictEqual(parsePnpmWorkspacePackages(yaml), ['packages/*']);
	});

	test('strips a trailing comment without treating a quoted "#" as one', () => {
		const yaml = [
			'packages:',
			"  - 'packages/*' # every package",
			"  - 'a#weird-name'",
		].join('\n');

		assert.deepStrictEqual(parsePnpmWorkspacePackages(yaml), ['packages/*', 'a#weird-name']);
	});

	test('ignores other top-level keys before and after "packages"', () => {
		const yaml = [
			'onlyBuiltDependencies:',
			'  - foo',
			'packages:',
			"  - 'packages/*'",
			'catalog:',
			'  react: ^19.0.0',
		].join('\n');

		assert.deepStrictEqual(parsePnpmWorkspacePackages(yaml), ['packages/*']);
	});

	test('returns nothing when there is no "packages" key', () => {
		assert.deepStrictEqual(parsePnpmWorkspacePackages('onlyBuiltDependencies:\n  - foo'), []);
	});

	test('returns nothing for an empty file', () => {
		assert.deepStrictEqual(parsePnpmWorkspacePackages(''), []);
	});
});

suite('resolvePnpmWorkspaceMembers', () => {
	teardown(removeProjects);

	test('resolves members from a real pnpm-workspace.yaml', () => {
		const root = createProject({ manifest: { name: 'root' } });

		writeFile(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
		writeFile(root, 'packages/app/package.json', JSON.stringify({ name: 'app' }));

		assert.deepStrictEqual(resolvePnpmWorkspaceMembers(root), [path.join(root, 'packages', 'app')]);
	});

	test('returns nothing when there is no pnpm-workspace.yaml at all', () => {
		const root = createProject({ manifest: { name: 'root' } });

		assert.deepStrictEqual(resolvePnpmWorkspaceMembers(root), []);
	});

	test('skips an exclusion pattern instead of resolving it as a literal path', () => {
		const root = createProject({ manifest: { name: 'root' } });

		writeFile(root, 'pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!**/test/**'\n");
		writeFile(root, 'packages/app/package.json', JSON.stringify({ name: 'app' }));

		const members = resolvePnpmWorkspaceMembers(root);

		assert.strictEqual(members.length, 1);
		assert.ok(members[0].endsWith('app'));
	});
});
