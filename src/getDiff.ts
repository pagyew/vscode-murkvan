import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import type { ReleaseType } from 'semver';
import type { PackageJson } from 'type-fest';

export const MANIFEST_FILENAME = 'package.json';
export const NODE_MODULES_DIRNAME = 'node_modules';
export const PACKAGE_LOCK_FILENAME = 'package-lock.json';
/** Written by npm 7+ next to `node_modules`; describes the tree actually installed. */
export const INSTALLED_LOCK_FILENAME = '.package-lock.json';

const DECLARED_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;
const TRANSITIVE_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** Matches a hoisted top-level entry, e.g. `node_modules/lodash` or `node_modules/@scope/pkg`. */
const TOP_LEVEL_PACKAGE_PATH = /^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/;

export type DiffType = ReleaseType | 'missing' | 'extra' | 'unknown';

/** What has to happen to `node_modules` for the manifest to be satisfied. */
export type ChangeDirection = 'upgrade' | 'downgrade' | 'unknown';

export type DiffError = 'manifest-not-found' | 'manifest-unreadable' | 'node-modules-not-found';

export interface PackageDiff {
	packageName: string;
	/** The range declared in `package.json`. Absent for extraneous packages. */
	declaredVersion?: string;
	/** The version found in `node_modules`. Absent when nothing is installed. */
	installedVersion?: string;
	diffType: DiffType;
	changeDirection: ChangeDirection;
}

export interface DiffOptions {
	/** Compare `devDependencies` as well as `dependencies`. Defaults to `true`. */
	includeDevDependencies?: boolean;
	/**
	 * Also report top-level packages that are installed but neither declared
	 * nor required by another package. Off by default: it costs one
	 * `package.json` read per installed package instead of one per declared
	 * dependency.
	 */
	includeExtraneous?: boolean;
}

export interface DiffResult {
	diffs: PackageDiff[];
	error?: DiffError;
}

interface LockfilePackageEntry {
	version?: string;
	dev?: boolean;
	/** A workspace member symlinked into `node_modules`; carries no comparable version. */
	link?: boolean;
}

interface Lockfile {
	packages?: Record<string, LockfilePackageEntry>;
}

function readJson<T>(filePath: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return undefined;
	}
}

function readManifest(nodeModulesPath: string, packageName: string): PackageJson | undefined {
	return readJson<PackageJson>(path.join(nodeModulesPath, ...packageName.split('/'), MANIFEST_FILENAME));
}

function readVersion(manifest: PackageJson | undefined): string | undefined {
	return typeof manifest?.version === 'string' ? manifest.version : undefined;
}

function readDirectory(directoryPath: string): fs.Dirent[] {
	try {
		return fs.readdirSync(directoryPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

/**
 * Yields the top-level package names inside `node_modules`, unwrapping scopes.
 *
 * Symlinks count as packages: npm and pnpm link workspace members instead of
 * copying them.
 */
function* listInstalledPackages(nodeModulesPath: string): Generator<string> {
	for (const entry of readDirectory(nodeModulesPath)) {
		if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) {
			continue;
		}

		if (!entry.name.startsWith('@')) {
			yield entry.name;
			continue;
		}

		for (const scoped of readDirectory(path.join(nodeModulesPath, entry.name))) {
			if (scoped.isDirectory() || scoped.isSymbolicLink()) {
				yield `${entry.name}/${scoped.name}`;
			}
		}
	}
}

/**
 * Compares one declared range against what is installed.
 *
 * @returns a diff when the installed version cannot satisfy the range, or
 * `undefined` when the package needs no action.
 */
function comparePackage(
	packageName: string,
	declaredVersion: string,
	installedVersion: string | undefined,
): PackageDiff | undefined {
	if (installedVersion === undefined) {
		return { packageName, declaredVersion, diffType: 'missing', changeDirection: 'upgrade' };
	}

	// `workspace:`, `file:`, `link:`, git URLs and npm aliases carry no
	// comparable version, so semver cannot judge them.
	if (semver.validRange(declaredVersion) === null) {
		return undefined;
	}

	if (semver.satisfies(installedVersion, declaredVersion, { includePrerelease: true })) {
		return undefined;
	}

	const requiredVersion = semver.minVersion(declaredVersion);

	if (!requiredVersion || semver.valid(installedVersion) === null) {
		return { packageName, declaredVersion, installedVersion, diffType: 'unknown', changeDirection: 'unknown' };
	}

	return {
		packageName,
		declaredVersion,
		installedVersion,
		diffType: semver.diff(requiredVersion, installedVersion) ?? 'unknown',
		changeDirection: semver.gt(requiredVersion, installedVersion) ? 'upgrade' : 'downgrade',
	};
}

function findExtraneous(nodeModulesPath: string, declaredPackages: Record<string, string>): PackageDiff[] {
	const installedVersions = new Map<string, string | undefined>();
	const requiredByOtherPackages = new Set<string>();

	for (const packageName of listInstalledPackages(nodeModulesPath)) {
		const manifest = readManifest(nodeModulesPath, packageName);

		if (!manifest) {
			continue;
		}

		installedVersions.set(packageName, readVersion(manifest));

		for (const field of TRANSITIVE_DEPENDENCY_FIELDS) {
			for (const dependency of Object.keys(manifest[field] ?? {})) {
				requiredByOtherPackages.add(dependency);
			}
		}
	}

	const extraneous: PackageDiff[] = [];

	for (const [packageName, installedVersion] of installedVersions) {
		if (Object.hasOwn(declaredPackages, packageName) || requiredByOtherPackages.has(packageName)) {
			continue;
		}

		extraneous.push({ packageName, installedVersion, diffType: 'extra', changeDirection: 'unknown' });
	}

	return extraneous;
}

/**
 * Compares the dependencies declared in `package.json` with the packages
 * present in `node_modules`, one manifest read per installed package.
 *
 * This is the fallback path: slower, and blind to transitive dependencies
 * that are not also declared directly. It runs when either lockfile is
 * missing or was not written by npm 7+, e.g. an older npm, or a tree
 * installed by yarn/pnpm/bun.
 *
 * Only actionable packages are reported: anything whose installed version
 * satisfies its declared range is left out.
 */
function getDiffFromManifest(manifest: PackageJson, nodeModulesPath: string, options: DiffOptions): DiffResult {
	const { includeDevDependencies = true, includeExtraneous = false } = options;

	const declaredPackages: Record<string, string> = {};

	for (const field of includeDevDependencies ? DECLARED_DEPENDENCY_FIELDS : ['dependencies' as const]) {
		for (const [packageName, declaredVersion] of Object.entries(manifest[field] ?? {})) {
			if (typeof declaredVersion === 'string') {
				declaredPackages[packageName] = declaredVersion;
			}
		}
	}

	const diffs: PackageDiff[] = [];

	for (const [packageName, declaredVersion] of Object.entries(declaredPackages)) {
		const diff = comparePackage(packageName, declaredVersion, readVersion(readManifest(nodeModulesPath, packageName)));

		if (diff) {
			diffs.push(diff);
		}
	}

	if (includeExtraneous) {
		diffs.push(...findExtraneous(nodeModulesPath, declaredPackages));
	}

	return { diffs };
}

function readLockfile(filePath: string): Lockfile | undefined {
	return readJson<Lockfile>(filePath);
}

/** Extracts hoisted top-level packages, unwrapping scopes and skipping workspace symlinks. */
function getTopLevelEntries(lockfile: Lockfile): Map<string, LockfilePackageEntry> {
	const entries = new Map<string, LockfilePackageEntry>();

	for (const [entryPath, entry] of Object.entries(lockfile.packages ?? {})) {
		const match = TOP_LEVEL_PACKAGE_PATH.exec(entryPath);

		if (match && !entry.link) {
			entries.set(match[1], entry);
		}
	}

	return entries;
}

/**
 * Compares one package's pinned version in `package-lock.json` against what
 * `node_modules/.package-lock.json` says is actually installed.
 *
 * Unlike {@link comparePackage}, both sides are exact versions, not a range —
 * the lockfile already resolved what the manifest's range should mean.
 */
function compareLockfileVersions(
	packageName: string,
	desiredVersion: string,
	installedVersion: string | undefined,
): PackageDiff | undefined {
	if (installedVersion === undefined) {
		return { packageName, declaredVersion: desiredVersion, diffType: 'missing', changeDirection: 'upgrade' };
	}

	if (desiredVersion === installedVersion) {
		return undefined;
	}

	if (semver.valid(desiredVersion) === null || semver.valid(installedVersion) === null) {
		return { packageName, declaredVersion: desiredVersion, installedVersion, diffType: 'unknown', changeDirection: 'unknown' };
	}

	return {
		packageName,
		declaredVersion: desiredVersion,
		installedVersion,
		diffType: semver.diff(installedVersion, desiredVersion) ?? 'unknown',
		changeDirection: semver.gt(desiredVersion, installedVersion) ? 'upgrade' : 'downgrade',
	};
}

/**
 * Compares the tree `package-lock.json` describes with the tree
 * `node_modules/.package-lock.json` says npm actually installed.
 *
 * This is the fast path: two JSON reads instead of one per installed
 * package, and it naturally covers transitive dependencies, since the
 * lockfile records the whole resolved tree rather than just what
 * `package.json` declares directly.
 *
 * @returns `undefined` when either lockfile is absent or was not written by
 * npm 7+, so the caller can fall back to walking `node_modules`.
 */
function getDiffFromLockfiles(pathToProject: string, options: DiffOptions): DiffResult | undefined {
	const desiredLockfile = readLockfile(path.join(pathToProject, PACKAGE_LOCK_FILENAME));
	const installedLockfile = readLockfile(path.join(pathToProject, NODE_MODULES_DIRNAME, INSTALLED_LOCK_FILENAME));

	if (!desiredLockfile?.packages || !installedLockfile?.packages) {
		return undefined;
	}

	const { includeDevDependencies = true, includeExtraneous = false } = options;

	const desired = getTopLevelEntries(desiredLockfile);
	const installed = getTopLevelEntries(installedLockfile);

	const diffs: PackageDiff[] = [];

	for (const [packageName, entry] of desired) {
		if ((!includeDevDependencies && entry.dev) || typeof entry.version !== 'string') {
			continue;
		}

		const diff = compareLockfileVersions(packageName, entry.version, installed.get(packageName)?.version);

		if (diff) {
			diffs.push(diff);
		}
	}

	if (includeExtraneous) {
		for (const [packageName, entry] of installed) {
			if (!desired.has(packageName) && typeof entry.version === 'string') {
				diffs.push({ packageName, installedVersion: entry.version, diffType: 'extra', changeDirection: 'unknown' });
			}
		}
	}

	return { diffs };
}

/**
 * Compares the dependencies declared in `package.json` with the packages
 * present in `node_modules`.
 *
 * Prefers diffing `package-lock.json` against `node_modules/.package-lock.json`
 * (see {@link getDiffFromLockfiles}); falls back to walking `node_modules`
 * manifest-by-manifest when either lockfile is unusable (see
 * {@link getDiffFromManifest}).
 */
export function getDiff(pathToProject: string, options: DiffOptions = {}): DiffResult {
	const manifestPath = path.join(pathToProject, MANIFEST_FILENAME);
	const nodeModulesPath = path.join(pathToProject, NODE_MODULES_DIRNAME);

	if (!fs.existsSync(manifestPath)) {
		return { diffs: [], error: 'manifest-not-found' };
	}

	const manifest = readJson<PackageJson>(manifestPath);

	if (!manifest) {
		return { diffs: [], error: 'manifest-unreadable' };
	}

	if (!fs.existsSync(nodeModulesPath)) {
		return { diffs: [], error: 'node-modules-not-found' };
	}

	return getDiffFromLockfiles(pathToProject, options) ?? getDiffFromManifest(manifest, nodeModulesPath, options);
}

/** Turns a diff into `name@range` specs that `npm install` understands. */
export function getPackagesToInstall(diffs: PackageDiff[]): string[] {
	return diffs
		.filter((diff): diff is PackageDiff & { declaredVersion: string } =>
			diff.diffType !== 'extra' && diff.declaredVersion !== undefined)
		.map(({ packageName, declaredVersion }) => `${packageName}@${declaredVersion}`);
}
