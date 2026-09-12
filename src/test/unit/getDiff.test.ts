import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getDiff, getPackagesToInstall, type PackageDiff } from '../../getDiff';
import { createProject, removeProjects, writeFile } from '../helpers/fixtures';

function findDiff(diffs: PackageDiff[], packageName: string) {
	const diff = diffs.find(candidate => candidate.packageName === packageName);

	assert.ok(diff, `expected a diff for "${packageName}", got ${JSON.stringify(diffs)}`);

	return diff;
}

suite('getDiff', () => {
	teardown(removeProjects);

	suite('preconditions', () => {
		test('reports a missing manifest', () => {
			const root = createProject({});

			assert.deepStrictEqual(getDiff(root), { diffs: [], error: 'manifest-not-found' });
		});

		test('reports an unparsable manifest', () => {
			const root = createProject({ manifest: '{ not json' });

			assert.deepStrictEqual(getDiff(root), { diffs: [], error: 'manifest-unreadable' });
		});

		test('reports missing node_modules', () => {
			const root = createProject({ manifest: { dependencies: { lodash: '^4.0.0' } }, nodeModules: false });

			assert.deepStrictEqual(getDiff(root), { diffs: [], error: 'node-modules-not-found' });
		});
	});

	suite('ranges', () => {
		// Regression: the previous implementation fed the raw range to
		// semver.diff, which throws "Invalid Version: ^4.17.0".
		test('accepts a version that satisfies a caret range', () => {
			const root = createProject({
				manifest: { dependencies: { lodash: '^4.17.0' } },
				installed: { lodash: { name: 'lodash', version: '4.17.21' } },
			});

			assert.deepStrictEqual(getDiff(root), { diffs: [] });
		});

		test('accepts a version that satisfies a tilde range', () => {
			const root = createProject({
				manifest: { dependencies: { semver: '~7.7.0' } },
				installed: { semver: { name: 'semver', version: '7.7.3' } },
			});

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});

		test('accepts an "x" range', () => {
			const root = createProject({
				manifest: { dependencies: { node: '20.x' } },
				installed: { node: { name: 'node', version: '20.4.0' } },
			});

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});

		test('ignores ranges semver cannot compare when the package is installed', () => {
			const root = createProject({
				manifest: {
					dependencies: {
						local: 'file:../local',
						linked: 'workspace:*',
						forked: 'git+https://example.test/forked.git',
					},
				},
				installed: {
					local: { version: '1.0.0' },
					linked: { version: '2.0.0' },
					forked: { version: '3.0.0' },
				},
			});

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});
	});

	suite('classification', () => {
		test('flags a declared package that is not installed', () => {
			const root = createProject({
				manifest: { dependencies: { lodash: '^4.17.0' } },
			});

			assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'lodash'), {
				packageName: 'lodash',
				declaredVersion: '^4.17.0',
				diffType: 'missing',
				changeDirection: 'upgrade',
			});
		});

		test('flags a package directory without a manifest as not installed', () => {
			const root = createProject({
				manifest: { dependencies: { lodash: '^4.17.0' } },
				installed: { lodash: null },
			});

			assert.strictEqual(findDiff(getDiff(root).diffs, 'lodash').diffType, 'missing');
		});

		test('flags an installed version behind a major', () => {
			const root = createProject({
				manifest: { dependencies: { react: '^19.0.0' } },
				installed: { react: { version: '18.3.1' } },
			});

			assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'react'), {
				packageName: 'react',
				declaredVersion: '^19.0.0',
				installedVersion: '18.3.1',
				diffType: 'major',
				changeDirection: 'upgrade',
			});
		});

		test('flags an installed version behind a minor', () => {
			const root = createProject({
				manifest: { dependencies: { semver: '~7.7.0' } },
				installed: { semver: { version: '7.6.0' } },
			});

			const diff = findDiff(getDiff(root).diffs, 'semver');

			assert.strictEqual(diff.diffType, 'minor');
			assert.strictEqual(diff.changeDirection, 'upgrade');
		});

		// The branch being switched to pins an older version than what is on disk.
		test('flags an installed version ahead of an exact pin as a downgrade', () => {
			const root = createProject({
				manifest: { dependencies: { react: '18.2.0' } },
				installed: { react: { version: '19.1.0' } },
			});

			assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'react'), {
				packageName: 'react',
				declaredVersion: '18.2.0',
				installedVersion: '19.1.0',
				diffType: 'major',
				changeDirection: 'downgrade',
			});
		});

		test('falls back to "unknown" for an unparsable installed version', () => {
			const root = createProject({
				manifest: { dependencies: { broken: '^1.0.0' } },
				installed: { broken: { version: 'not-a-version' } },
			});

			assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'broken'), {
				packageName: 'broken',
				declaredVersion: '^1.0.0',
				installedVersion: 'not-a-version',
				diffType: 'unknown',
				changeDirection: 'unknown',
			});
		});

		test('compares scoped packages', () => {
			const root = createProject({
				manifest: { dependencies: { '@scope/ok': '^1.0.0', '@scope/stale': '^2.0.0' } },
				installed: {
					'@scope/ok': { version: '1.2.0' },
					'@scope/stale': { version: '1.0.0' },
				},
			});

			const { diffs } = getDiff(root);

			assert.strictEqual(diffs.length, 1);
			assert.strictEqual(findDiff(diffs, '@scope/stale').diffType, 'major');
		});

		// Regression: packages that other packages depend on used to be skipped
		// wholesale, hiding real changes to direct dependencies.
		test('flags a direct dependency that is also required by another package', () => {
			const root = createProject({
				manifest: { dependencies: { lodash: '^4.17.0', consumer: '^1.0.0' } },
				installed: {
					lodash: { version: '3.10.1' },
					consumer: { version: '1.0.0', dependencies: { lodash: '^3.0.0' } },
				},
			});

			assert.strictEqual(findDiff(getDiff(root).diffs, 'lodash').diffType, 'major');
		});
	});

	suite('devDependencies', () => {
		const project = () => createProject({
			manifest: {
				dependencies: { lodash: '^4.17.0' },
				devDependencies: { typescript: '^5.7.0' },
			},
			installed: {
				lodash: { version: '4.17.21' },
				typescript: { version: '4.9.5' },
			},
		});

		test('are compared by default', () => {
			assert.strictEqual(findDiff(getDiff(project()).diffs, 'typescript').diffType, 'major');
		});

		test('are skipped when disabled', () => {
			assert.deepStrictEqual(getDiff(project(), { includeDevDependencies: false }).diffs, []);
		});
	});

	suite('extraneous packages', () => {
		const project = () => createProject({
			manifest: { dependencies: { consumer: '^1.0.0' } },
			installed: {
				consumer: { version: '1.0.0', dependencies: { hoisted: '^1.0.0' } },
				hoisted: { version: '1.0.0' },
				leftover: { version: '9.9.9' },
				'.bin': { version: '0.0.0' },
			},
		});

		test('are not reported by default', () => {
			assert.deepStrictEqual(getDiff(project()).diffs, []);
		});

		test('report only packages nothing depends on', () => {
			const { diffs } = getDiff(project(), { includeExtraneous: true });

			assert.deepStrictEqual(diffs, [{
				packageName: 'leftover',
				installedVersion: '9.9.9',
				diffType: 'extra',
				changeDirection: 'unknown',
			}]);
		});
	});

	suite('workspaces', () => {
		// Regression: a dependency only a workspace member declares used to be
		// invisible — only the root manifest's own fields were ever read.
		test('flags drift in a dependency only a workspace member declares', () => {
			const root = createProject({
				manifest: { workspaces: ['packages/*'] },
				installed: { lodash: { version: '3.10.1' } },
			});

			writeFile(root, 'packages/app/package.json', JSON.stringify({
				name: 'app',
				dependencies: { lodash: '^4.17.0' },
			}));

			assert.strictEqual(findDiff(getDiff(root).diffs, 'lodash').diffType, 'major');
		});

		test('supports the yarn "{ packages }" object form', () => {
			const root = createProject({
				manifest: { workspaces: { packages: ['packages/*'] } },
				installed: { lodash: { version: '3.10.1' } },
			});

			writeFile(root, 'packages/app/package.json', JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));

			assert.strictEqual(findDiff(getDiff(root).diffs, 'lodash').diffType, 'major');
		});

		test('supports a literal workspace path without a glob', () => {
			const root = createProject({
				manifest: { workspaces: ['apps/api'] },
				installed: { lodash: { version: '3.10.1' } },
			});

			writeFile(root, 'apps/api/package.json', JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));

			assert.strictEqual(findDiff(getDiff(root).diffs, 'lodash').diffType, 'major');
		});

		test('ignores a workspace glob match without a package.json', () => {
			const root = createProject({
				manifest: { workspaces: ['packages/*'] },
				installed: { lodash: { version: '4.17.21' } },
			});

			fs.mkdirSync(path.join(root, 'packages', 'not-a-package'), { recursive: true });

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});

		test('does not resolve unsupported glob shapes such as "**"', () => {
			const root = createProject({
				manifest: { workspaces: ['packages/**'] },
				installed: { lodash: { version: '3.10.1' } },
			});

			writeFile(root, 'packages/nested/app/package.json', JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});

		test('leaves a project without a "workspaces" field unaffected', () => {
			const root = createProject({
				manifest: { dependencies: { lodash: '^4.17.0' } },
				installed: { lodash: { version: '4.17.21' } },
			});

			writeFile(root, 'packages/app/package.json', JSON.stringify({ dependencies: { lodash: '^1.0.0' } }));

			assert.deepStrictEqual(getDiff(root).diffs, []);
		});
	});
});

suite('getDiff from lockfiles', () => {
	teardown(removeProjects);

	test('prefers the lockfiles over walking node_modules when both are valid', () => {
		const root = createProject({
			manifest: { dependencies: { lodash: '^4.0.0' } },
			// The manifest-walk fallback would find this and report it in sync;
			// the lockfile path must win and report the mismatch it describes.
			installed: { lodash: { version: '4.17.21' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/lodash': { version: '4.18.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/lodash': { version: '4.17.21' },
			} },
		});

		assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'lodash'), {
			packageName: 'lodash',
			declaredVersion: '4.18.0',
			installedVersion: '4.17.21',
			diffType: 'minor',
			changeDirection: 'upgrade',
		});
	});

	test('covers a transitive dependency package.json never declares directly', () => {
		const root = createProject({
			manifest: { dependencies: { consumer: '^1.0.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/consumer': { version: '1.0.0' },
				'node_modules/transitive': { version: '2.0.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/consumer': { version: '1.0.0' },
				'node_modules/transitive': { version: '1.0.0' },
			} },
		});

		assert.strictEqual(findDiff(getDiff(root).diffs, 'transitive').diffType, 'major');
	});

	test('reports a package the installed lockfile is missing entirely', () => {
		const root = createProject({
			manifest: { dependencies: { lodash: '^4.0.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/lodash': { version: '4.18.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
			} },
		});

		assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'lodash'), {
			packageName: 'lodash',
			declaredVersion: '4.18.0',
			diffType: 'missing',
			changeDirection: 'upgrade',
		});
	});

	test('reports no diff when the installed version matches exactly', () => {
		const root = createProject({
			manifest: { dependencies: { lodash: '^4.0.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/lodash': { version: '4.18.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/lodash': { version: '4.18.0' },
			} },
		});

		assert.deepStrictEqual(getDiff(root).diffs, []);
	});

	test('reports an installed version ahead of the lockfile as a downgrade', () => {
		const root = createProject({
			manifest: { dependencies: { react: '18.2.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/react': { version: '18.2.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/react': { version: '19.1.0' },
			} },
		});

		assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'react'), {
			packageName: 'react',
			declaredVersion: '18.2.0',
			installedVersion: '19.1.0',
			diffType: 'major',
			changeDirection: 'downgrade',
		});
	});

	test('falls back to "unknown" for an unparsable installed version', () => {
		const root = createProject({
			manifest: { dependencies: { broken: '^1.0.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/broken': { version: '1.0.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/broken': { version: 'not-a-version' },
			} },
		});

		assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'broken'), {
			packageName: 'broken',
			declaredVersion: '1.0.0',
			installedVersion: 'not-a-version',
			diffType: 'unknown',
			changeDirection: 'unknown',
		});
	});

	test('skips workspace members symlinked into node_modules', () => {
		const root = createProject({
			manifest: { dependencies: { linked: 'workspace:*' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/linked': { link: true, resolved: 'packages/linked' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/linked': { link: true, resolved: 'packages/linked' },
			} },
		});

		assert.deepStrictEqual(getDiff(root).diffs, []);
	});

	suite('devDependencies', () => {
		const project = () => createProject({
			manifest: { dependencies: {}, devDependencies: { typescript: '^5.7.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/typescript': { version: '5.7.0', dev: true },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/typescript': { version: '4.9.5', dev: true },
			} },
		});

		test('are compared by default', () => {
			assert.strictEqual(findDiff(getDiff(project()).diffs, 'typescript').diffType, 'major');
		});

		test('are skipped when disabled', () => {
			assert.deepStrictEqual(getDiff(project(), { includeDevDependencies: false }).diffs, []);
		});
	});

	suite('extraneous packages', () => {
		const project = () => createProject({
			manifest: { dependencies: { consumer: '^1.0.0' } },
			lockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/consumer': { version: '1.0.0' },
			} },
			installedLockfile: { lockfileVersion: 3, packages: {
				'': { name: 'root', version: '1.0.0' },
				'node_modules/consumer': { version: '1.0.0' },
				'node_modules/leftover': { version: '9.9.9' },
			} },
		});

		test('are not reported by default', () => {
			assert.deepStrictEqual(getDiff(project()).diffs, []);
		});

		test('report packages the desired lockfile does not list', () => {
			assert.deepStrictEqual(getDiff(project(), { includeExtraneous: true }).diffs, [{
				packageName: 'leftover',
				installedVersion: '9.9.9',
				diffType: 'extra',
				changeDirection: 'unknown',
			}]);
		});
	});

	suite('fallback to node_modules', () => {
		test('falls back when node_modules/.package-lock.json is missing (e.g. yarn or pnpm)', () => {
			const root = createProject({
				manifest: { dependencies: { react: '^19.0.0' } },
				installed: { react: { version: '18.3.1' } },
				lockfile: { lockfileVersion: 3, packages: {
					'': { name: 'root', version: '1.0.0' },
					'node_modules/react': { version: '19.0.0' },
				} },
			});

			assert.deepStrictEqual(findDiff(getDiff(root).diffs, 'react'), {
				packageName: 'react',
				declaredVersion: '^19.0.0',
				installedVersion: '18.3.1',
				diffType: 'major',
				changeDirection: 'upgrade',
			});
		});

		test('falls back when package-lock.json has no lockfileVersion-3 "packages" field', () => {
			const root = createProject({
				manifest: { dependencies: { react: '^19.0.0' } },
				installed: { react: { version: '18.3.1' } },
				lockfile: { lockfileVersion: 1, dependencies: { react: { version: '19.0.0' } } },
				installedLockfile: { lockfileVersion: 1, dependencies: { react: { version: '18.3.1' } } },
			});

			assert.strictEqual(findDiff(getDiff(root).diffs, 'react').diffType, 'major');
		});

		test('falls back when package-lock.json is absent', () => {
			const root = createProject({
				manifest: { dependencies: { react: '^19.0.0' } },
				installed: { react: { version: '18.3.1' } },
				installedLockfile: { lockfileVersion: 3, packages: {
					'': { name: 'root', version: '1.0.0' },
					'node_modules/react': { version: '18.3.1' },
				} },
			});

			assert.strictEqual(findDiff(getDiff(root).diffs, 'react').diffType, 'major');
		});
	});
});

suite('getPackagesToInstall', () => {
	test('builds name@range specs', () => {
		assert.deepStrictEqual(getPackagesToInstall([
			{ packageName: 'lodash', declaredVersion: '^4.17.0', diffType: 'missing', changeDirection: 'upgrade' },
			{ packageName: '@scope/pkg', declaredVersion: '~2.1.0', installedVersion: '2.0.0', diffType: 'minor', changeDirection: 'upgrade' },
		]), ['lodash@^4.17.0', '@scope/pkg@~2.1.0']);
	});

	test('skips extraneous packages, which have nothing to install', () => {
		assert.deepStrictEqual(getPackagesToInstall([
			{ packageName: 'leftover', installedVersion: '9.9.9', diffType: 'extra', changeDirection: 'unknown' },
		]), []);
	});
});
