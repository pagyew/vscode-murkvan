import fs from 'node:fs';
import path from 'node:path';
import type { PackageJson } from 'type-fest';

export const MANIFEST_FILENAME = 'package.json';

export type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageManager {
	id: PackageManagerId;
	/** The executable to spawn, resolved for the current platform. */
	command: string;
	/**
	 * Args that install exactly these `name@version` specs without touching
	 * `package.json` or the lockfile.
	 *
	 * `undefined` when the manager cannot do this: yarn's and pnpm's `add`
	 * always rewrite `package.json`, and Murkvan's one promise is to never
	 * touch it — only `node_modules` gets synced.
	 */
	installArgs(specs: string[]): string[] | undefined;
	/** Args that reinstall the whole tree straight from the lockfile. */
	reinstallArgs: string[];
}

/** Lockfile filenames that identify each manager. Bun's binary format still counts. */
const LOCKFILE_NAMES: Record<PackageManagerId, readonly string[]> = {
	npm: ['package-lock.json'],
	pnpm: ['pnpm-lock.yaml'],
	yarn: ['yarn.lock'],
	bun: ['bun.lock', 'bun.lockb'],
};

/** Every lockfile name Murkvan can discover, npm first since it's the most common. */
export const ALL_LOCKFILE_NAMES: readonly string[] = Object.values(LOCKFILE_NAMES).flat();

/** Priority used to pick a manager when more than one lockfile is present. */
const DETECTION_PRIORITY: readonly PackageManagerId[] = ['npm', 'pnpm', 'yarn', 'bun'];

const EXECUTABLES: Record<PackageManagerId, string> = {
	npm: 'npm',
	pnpm: 'pnpm',
	yarn: 'yarn',
	bun: 'bun',
};

function commandFor(id: PackageManagerId): string {
	return process.platform === 'win32' ? `${EXECUTABLES[id]}.cmd` : EXECUTABLES[id];
}

const DEFINITIONS: Record<PackageManagerId, Omit<PackageManager, 'command'>> = {
	npm: {
		id: 'npm',
		installArgs: specs => ['i', '--no-package-lock', '--no-save', ...specs],
		reinstallArgs: ['ci'],
	},
	pnpm: {
		id: 'pnpm',
		installArgs: () => undefined,
		reinstallArgs: ['install', '--frozen-lockfile'],
	},
	yarn: {
		id: 'yarn',
		installArgs: () => undefined,
		reinstallArgs: ['install', '--frozen-lockfile'],
	},
	bun: {
		id: 'bun',
		installArgs: specs => ['add', '--no-save', ...specs],
		reinstallArgs: ['install', '--frozen-lockfile'],
	},
};

export function getPackageManager(id: PackageManagerId): PackageManager {
	return { ...DEFINITIONS[id], command: commandFor(id) };
}

function managerForLockfile(lockfileName: string): PackageManagerId | undefined {
	return (Object.keys(LOCKFILE_NAMES) as PackageManagerId[]).find(id => LOCKFILE_NAMES[id].includes(lockfileName));
}

function readManifest(manifestPath: string): PackageJson | undefined {
	try {
		return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PackageJson;
	} catch {
		return undefined;
	}
}

function declaredManager(manifest: PackageJson | undefined): PackageManagerId | undefined {
	const field = typeof manifest?.packageManager === 'string' ? manifest.packageManager.split('@')[0] : undefined;

	return field !== undefined && field in LOCKFILE_NAMES ? field as PackageManagerId : undefined;
}

/**
 * Picks which lockfile governs the project, given every lockfile path
 * Murkvan found in the workspace. A project should have exactly one; when
 * more than one is present — typically left over from switching package
 * managers — `packageManager` in `package.json` wins when it names one of
 * them, otherwise a fixed priority applies.
 */
export function selectLockfile(lockfilePaths: string[]): string | undefined {
	if (lockfilePaths.length <= 1) {
		return lockfilePaths[0];
	}

	const byManager = new Map<PackageManagerId, string>();

	for (const lockfilePath of lockfilePaths) {
		const id = managerForLockfile(path.basename(lockfilePath));

		if (id && !byManager.has(id)) {
			byManager.set(id, lockfilePath);
		}
	}

	for (const lockfilePath of lockfilePaths) {
		const declared = declaredManager(readManifest(path.join(path.dirname(lockfilePath), MANIFEST_FILENAME)));

		if (declared && byManager.has(declared)) {
			return byManager.get(declared);
		}
	}

	for (const id of DETECTION_PRIORITY) {
		const found = byManager.get(id);

		if (found) {
			return found;
		}
	}

	return lockfilePaths[0];
}

/** Resolves the package manager that owns a lockfile Murkvan found, defaulting to npm. */
export function detectPackageManager(lockfilePath: string): PackageManager {
	return getPackageManager(managerForLockfile(path.basename(lockfilePath)) ?? 'npm');
}
