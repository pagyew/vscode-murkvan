import { spawnSync } from 'node:child_process';

const ARC_COMMAND = 'arc';
const ARC_TIMEOUT_MS = 5_000;

export interface CommandResult {
	error?: Error;
	status: number | null;
	stdout: string;
}

/**
 * Extracts a repository root from an `arc root` invocation.
 *
 * Split out from {@link findArcRoot} so the decision logic stays testable
 * without an Arc installation.
 */
export function parseArcRoot(result: CommandResult): string | undefined {
	if (result.error || result.status !== 0) {
		return undefined;
	}

	const root = result.stdout.trim();

	return root.length > 0 ? root : undefined;
}

/**
 * Resolves the Arc repository root for `cwd`.
 *
 * Probing with `arc root` doubles as a presence check: the previous
 * `command -v arc` probe could never succeed, because `command` is a shell
 * builtin and `spawnSync` runs without a shell.
 *
 * @returns the repository root, or `undefined` when Arc is unavailable or
 * `cwd` is not inside an Arc repository.
 */
export function findArcRoot(cwd: string, command: string = ARC_COMMAND): string | undefined {
	const result = spawnSync(command, ['root'], {
		cwd,
		encoding: 'utf-8',
		windowsHide: true,
		timeout: ARC_TIMEOUT_MS,
	});

	return parseArcRoot({
		error: result.error,
		status: result.status,
		stdout: result.stdout ?? '',
	});
}
