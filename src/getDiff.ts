import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import type { ReleaseType } from 'semver';
import type { PackageJson } from 'type-fest';

export const MANIFEST_FILENAME = 'package.json';
export const NODE_MODULES_DIRNAME = 'node_modules';

const DECLARED_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const;
const TRANSITIVE_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

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
 * present in `node_modules`.
 *
 * Only actionable packages are reported: anything whose installed version
 * satisfies its declared range is left out.
 */
export function getDiff(pathToProject: string, options: DiffOptions = {}): DiffResult {
	const { includeDevDependencies = true, includeExtraneous = false } = options;

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

/** Turns a diff into `name@range` specs that `npm install` understands. */
export function getPackagesToInstall(diffs: PackageDiff[]): string[] {
	return diffs
		.filter((diff): diff is PackageDiff & { declaredVersion: string } =>
			diff.diffType !== 'extra' && diff.declaredVersion !== undefined)
		.map(({ packageName, declaredVersion }) => `${packageName}@${declaredVersion}`);
}
