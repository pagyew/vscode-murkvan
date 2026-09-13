import { spawnSync } from 'node:child_process';

const ARC_COMMAND = 'arc';
const ARC_TIMEOUT_MS = 5_000;
const GIT_COMMAND = 'git';
const GIT_TIMEOUT_MS = 5_000;

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

/**
 * Extracts a branch name from a `git rev-parse --abbrev-ref HEAD` invocation.
 *
 * Split out from {@link getCurrentBranch} so the decision logic stays
 * testable without a real Git invocation.
 */
export function parseBranch(result: CommandResult): string | undefined {
	if (result.error || result.status !== 0) {
		return undefined;
	}

	const branch = result.stdout.trim();

	return branch.length > 0 ? branch : undefined;
}

/**
 * Resolves the current Git branch for `cwd`.
 *
 * A detached HEAD reports the literal string `HEAD` — treated here as its
 * own pseudo-branch, since it is always safe to key state by even though it
 * is never especially "remembered" across different detached commits.
 *
 * @returns the branch name, or `undefined` when `cwd` is not inside a Git
 * repository or `git` is not on `PATH`.
 */
export function getCurrentBranch(cwd: string, command: string = GIT_COMMAND): string | undefined {
	const result = spawnSync(command, ['rev-parse', '--abbrev-ref', 'HEAD'], {
		cwd,
		encoding: 'utf-8',
		windowsHide: true,
		timeout: GIT_TIMEOUT_MS,
	});

	return parseBranch({
		error: result.error,
		status: result.status,
		stdout: result.stdout ?? '',
	});
}
