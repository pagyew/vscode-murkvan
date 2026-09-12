import fs from 'node:fs';
import path from 'node:path';

export function readDirectory(directoryPath: string): fs.Dirent[] {
	try {
		return fs.readdirSync(directoryPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

/**
 * Resolves one workspace glob pattern into candidate directories.
 *
 * Only the two shapes real workspace patterns almost always take are
 * supported: a literal path (`"apps/api"`) and a single trailing `*`
 * matching any immediate subdirectory (`"packages/*"`). A pattern that needs
 * more than that — recursive `**`, brace expansion, a `*` mid-segment — is
 * skipped rather than mis-resolved; the caller still picks up every
 * workspace covered by a simpler sibling pattern.
 *
 * Shared between npm/yarn's `workspaces` field and pnpm's
 * `pnpm-workspace.yaml`, since both name workspace members the same way.
 */
export function resolveWorkspacePattern(pathToProject: string, pattern: string): string[] {
	if (!pattern.includes('*')) {
		return [path.join(pathToProject, pattern)];
	}

	const segments = pattern.split('/');

	if (segments.at(-1) !== '*' || segments.slice(0, -1).some(segment => segment.includes('*'))) {
		return [];
	}

	const parentDir = path.join(pathToProject, ...segments.slice(0, -1));

	return readDirectory(parentDir)
		.filter(entry => entry.isDirectory())
		.map(entry => path.join(parentDir, entry.name));
}
