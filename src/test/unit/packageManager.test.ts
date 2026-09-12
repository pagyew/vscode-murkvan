import assert from 'node:assert';
import path from 'node:path';
import {
	ALL_LOCKFILE_NAMES,
	detectPackageManager,
	getPackageManager,
	groupLockfilesByProject,
	selectLockfile,
} from '../../packageManager';
import { createProject, removeProjects } from '../helpers/fixtures';

suite('ALL_LOCKFILE_NAMES', () => {
	test('lists every lockfile Murkvan recognizes, npm first', () => {
		assert.deepStrictEqual(ALL_LOCKFILE_NAMES, [
			'package-lock.json',
			'pnpm-lock.yaml',
			'yarn.lock',
			'bun.lock',
			'bun.lockb',
		]);
	});
});

suite('getPackageManager', () => {
	test('npm installs pinned specs without touching the lockfile or manifest', () => {
		const npm = getPackageManager('npm');

		assert.deepStrictEqual(npm.installArgs(['lodash@4.18.0']), ['i', '--no-package-lock', '--no-save', 'lodash@4.18.0']);
		assert.deepStrictEqual(npm.reinstallArgs, ['ci']);
	});

	test('bun installs pinned specs without saving', () => {
		const bun = getPackageManager('bun');

		assert.deepStrictEqual(bun.installArgs(['lodash@4.18.0']), ['add', '--no-save', 'lodash@4.18.0']);
		assert.deepStrictEqual(bun.reinstallArgs, ['install', '--frozen-lockfile']);
	});

	// Regression: yarn's and pnpm's `add` always rewrite package.json — there is
	// no equivalent to npm's `--no-save`, so a targeted install isn't offered.
	test('yarn cannot install without saving to package.json', () => {
		assert.strictEqual(getPackageManager('yarn').installArgs(['lodash@4.18.0']), undefined);
	});

	test('pnpm cannot install without saving to package.json', () => {
		assert.strictEqual(getPackageManager('pnpm').installArgs(['lodash@4.18.0']), undefined);
	});

	test('yarn and pnpm reinstall everything with a frozen lockfile', () => {
		assert.deepStrictEqual(getPackageManager('yarn').reinstallArgs, ['install', '--frozen-lockfile']);
		assert.deepStrictEqual(getPackageManager('pnpm').reinstallArgs, ['install', '--frozen-lockfile']);
	});
});

suite('detectPackageManager', () => {
	test('recognizes package-lock.json as npm', () => {
		assert.strictEqual(detectPackageManager('/project/package-lock.json').id, 'npm');
	});

	test('recognizes pnpm-lock.yaml as pnpm', () => {
		assert.strictEqual(detectPackageManager('/project/pnpm-lock.yaml').id, 'pnpm');
	});

	test('recognizes yarn.lock as yarn', () => {
		assert.strictEqual(detectPackageManager('/project/yarn.lock').id, 'yarn');
	});

	test('recognizes both bun lockfile formats as bun', () => {
		assert.strictEqual(detectPackageManager('/project/bun.lock').id, 'bun');
		assert.strictEqual(detectPackageManager('/project/bun.lockb').id, 'bun');
	});

	test('defaults to npm for an unrecognized lockfile name', () => {
		assert.strictEqual(detectPackageManager('/project/some-other.lock').id, 'npm');
	});
});

suite('selectLockfile', () => {
	teardown(removeProjects);

	test('returns undefined when nothing was found', () => {
		assert.strictEqual(selectLockfile([]), undefined);
	});

	test('returns the only candidate without reading package.json', () => {
		assert.strictEqual(selectLockfile(['/project/yarn.lock']), '/project/yarn.lock');
	});

	test('prefers npm by priority when package.json names no manager', () => {
		const root = createProject({ manifest: { name: 'root' } });
		const npmLock = path.join(root, 'package-lock.json');
		const yarnLock = path.join(root, 'yarn.lock');
		const bunLock = path.join(root, 'bun.lock');

		assert.strictEqual(selectLockfile([yarnLock, bunLock, npmLock]), npmLock);
	});

	test('falls back through the priority order when npm is not among the candidates', () => {
		const root = createProject({ manifest: { name: 'root' } });
		const yarnLock = path.join(root, 'yarn.lock');
		const bunLock = path.join(root, 'bun.lock');

		assert.strictEqual(selectLockfile([bunLock, yarnLock]), yarnLock);
	});

	// Regression: leftovers from switching package managers (e.g. an old
	// package-lock.json after moving to pnpm) should not silently win just
	// because npm ranks first in the fixed priority order.
	test('prefers the manager package.json declares over the fixed priority', () => {
		const root = createProject({ manifest: { name: 'root', packageManager: 'pnpm@9.1.0' } });
		const npmLock = path.join(root, 'package-lock.json');
		const pnpmLock = path.join(root, 'pnpm-lock.yaml');

		assert.strictEqual(selectLockfile([npmLock, pnpmLock]), pnpmLock);
	});

	test('ignores a declared manager whose lockfile is not among the candidates', () => {
		const root = createProject({ manifest: { name: 'root', packageManager: 'pnpm@9.1.0' } });
		const npmLock = path.join(root, 'package-lock.json');
		const yarnLock = path.join(root, 'yarn.lock');

		assert.strictEqual(selectLockfile([npmLock, yarnLock]), npmLock);
	});

	test('ignores an unparsable package.json and falls back to priority', () => {
		const root = createProject({ manifest: '{ not json' });
		const npmLock = path.join(root, 'package-lock.json');
		const yarnLock = path.join(root, 'yarn.lock');

		assert.strictEqual(selectLockfile([yarnLock, npmLock]), npmLock);
	});
});

suite('groupLockfilesByProject', () => {
	teardown(removeProjects);

	test('returns nothing for an empty workspace', () => {
		assert.deepStrictEqual(groupLockfilesByProject([]), []);
	});

	test('keeps one lockfile per distinct directory — the multi-root case', () => {
		const frontend = createProject({ manifest: { name: 'frontend' } });
		const backend = createProject({ manifest: { name: 'backend' } });
		const frontendLock = path.join(frontend, 'package-lock.json');
		const backendLock = path.join(backend, 'yarn.lock');

		const projects = groupLockfilesByProject([frontendLock, backendLock]);

		assert.strictEqual(projects.length, 2);
		assert.ok(projects.includes(frontendLock));
		assert.ok(projects.includes(backendLock));
	});

	// Regression: a directory with two lockfiles (e.g. left over from
	// switching managers) must collapse to one project, not two.
	test('collapses more than one lockfile in the same directory into a single project', () => {
		const root = createProject({ manifest: { name: 'root', packageManager: 'pnpm@9.1.0' } });
		const npmLock = path.join(root, 'package-lock.json');
		const pnpmLock = path.join(root, 'pnpm-lock.yaml');

		assert.deepStrictEqual(groupLockfilesByProject([npmLock, pnpmLock]), [pnpmLock]);
	});
});
