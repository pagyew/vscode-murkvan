import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspacePattern } from './workspaceGlob';

export const PNPM_WORKSPACE_FILENAME = 'pnpm-workspace.yaml';

const MANIFEST_FILENAME = 'package.json';

/** Strips a trailing `# comment`, ignoring a `#` inside a quoted string. */
function stripComment(line: string): string {
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
		} else if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
		} else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
			return line.slice(0, i);
		}
	}

	return line;
}

/** Strips one layer of matching quotes, if the whole trimmed value is wrapped in them. */
function unquote(value: string): string {
	const trimmed = value.trim();
	const firstChar = trimmed[0];

	if (trimmed.length >= 2 && (firstChar === "'" || firstChar === '"') && trimmed.endsWith(firstChar)) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

function parseFlowSequence(content: string): string[] {
	const inner = content.trim().replace(/^\[/, '').replace(/\]$/, '');

	return inner.split(',').map(item => unquote(item)).filter(item => item.length > 0);
}

/**
 * Extracts the `packages:` list from a `pnpm-workspace.yaml` file's raw text.
 *
 * This is not a YAML parser — it only understands the two shapes a
 * `packages:` list realistically takes: a block sequence (`- 'pattern'` on
 * indented lines beneath the key) or a flow sequence on the key's own line
 * (`packages: ['a', 'b']`) — and ignores every other key in the file.
 */
export function parsePnpmWorkspacePackages(yamlContent: string): string[] {
	const lines = yamlContent.split(/\r?\n/);
	const keyIndex = lines.findIndex(line => /^packages\s*:/.test(line));

	if (keyIndex === -1) {
		return [];
	}

	const afterColon = stripComment(lines[keyIndex].replace(/^packages\s*:/, '')).trim();

	if (afterColon.startsWith('[')) {
		return parseFlowSequence(afterColon);
	}

	const packages: string[] = [];

	for (let i = keyIndex + 1; i < lines.length; i++) {
		const line = stripComment(lines[i]);

		if (line.trim().length === 0) {
			continue;
		}

		const item = /^\s+-\s*(.+)$/.exec(line);

		if (!item) {
			break;
		}

		const value = unquote(item[1]);

		if (value.length > 0) {
			packages.push(value);
		}
	}

	return packages;
}

/**
 * Resolves every pnpm workspace member directory declared by
 * `pnpm-workspace.yaml`'s `packages:` list, keeping only the ones that
 * actually contain a `package.json`.
 *
 * A pattern starting with `!` is an exclusion in pnpm's own glob syntax,
 * which this does not implement, so it is skipped outright rather than
 * resolved as a literal (and almost certainly nonexistent) path.
 *
 * @returns `[]` when there is no `pnpm-workspace.yaml` at all — every
 * non-pnpm project, and any pnpm project without workspaces.
 */
export function resolvePnpmWorkspaceMembers(pathToProject: string): string[] {
	let content: string;

	try {
		content = fs.readFileSync(path.join(pathToProject, PNPM_WORKSPACE_FILENAME), 'utf-8');
	} catch {
		return [];
	}

	const members: string[] = [];

	for (const pattern of parsePnpmWorkspacePackages(content)) {
		if (pattern.startsWith('!')) {
			continue;
		}

		for (const memberDir of resolveWorkspacePattern(pathToProject, pattern)) {
			if (fs.existsSync(path.join(memberDir, MANIFEST_FILENAME))) {
				members.push(memberDir);
			}
		}
	}

	return members;
}
