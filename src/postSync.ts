import { exec } from 'node:child_process';

export interface ShellCommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Runs `command` through the shell in `cwd`, resolving rather than rejecting
 * on a non-zero exit so callers can decide for themselves how to surface a
 * post-sync script's own failure instead of it arriving as a thrown error.
 */
export function runShellCommand(command: string, cwd: string): Promise<ShellCommandResult> {
	return new Promise(resolve => {
		exec(command, { cwd }, (error, stdout, stderr) => {
			const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;

			resolve({ code, stdout, stderr });
		});
	});
}
