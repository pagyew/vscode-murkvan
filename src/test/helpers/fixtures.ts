import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A `package.json` body, or raw text when a test needs malformed JSON. */
export type ManifestSpec = Record<string, unknown> | string;

export interface ProjectSpec {
	/** Omit to leave the project without a manifest. */
	manifest?: ManifestSpec;
	/**
	 * Packages to place in `node_modules`, keyed by package name.
	 * `null` creates the directory without a `package.json`.
	 */
	installed?: Record<string, ManifestSpec | null>;
	/** Create `node_modules` even when no package is installed. Defaults to `true`. */
	nodeModules?: boolean;
}

const createdProjects: string[] = [];

function write(filePath: string, content: ManifestSpec) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

/** Builds a throwaway project on disk and returns its root. */
export function createProject({ manifest, installed = {}, nodeModules = true }: ProjectSpec): string {
	const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'murkvan-test-'));

	createdProjects.push(root);

	if (manifest !== undefined) {
		write(path.join(root, 'package.json'), manifest);
	}

	if (nodeModules) {
		fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	}

	for (const [packageName, packageManifest] of Object.entries(installed)) {
		const packagePath = path.join(root, 'node_modules', ...packageName.split('/'));

		fs.mkdirSync(packagePath, { recursive: true });

		if (packageManifest !== null) {
			write(path.join(packagePath, 'package.json'), packageManifest);
		}
	}

	return root;
}

/** Writes a file inside a project created by {@link createProject}. */
export function writeFile(root: string, relativePath: string, content: string): string {
	const filePath = path.join(root, relativePath);

	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);

	return filePath;
}

/** Removes every project created so far. Call from a test teardown hook. */
export function removeProjects() {
	while (createdProjects.length > 0) {
		fs.rmSync(createdProjects.pop()!, { recursive: true, force: true });
	}
}
