import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { runShellCommand } from '../../postSync';

// Commands are run via `node -e` rather than shell builtins like `exit`, so
// these tests don't depend on which shell is available on the runner.
suite('runShellCommand', () => {
	test('captures stdout on success', async () => {
		const result = await runShellCommand('node -e "console.log(\'hi\')"', os.tmpdir());

		assert.strictEqual(result.code, 0);
		assert.match(result.stdout, /hi/);
	});

	test('reports a non-zero exit code', async () => {
		const result = await runShellCommand('node -e "process.exit(2)"', os.tmpdir());

		assert.strictEqual(result.code, 2);
	});

	test('captures stderr', async () => {
		const result = await runShellCommand('node -e "console.error(\'bad\'); process.exit(1)"', os.tmpdir());

		assert.strictEqual(result.code, 1);
		assert.match(result.stderr, /bad/);
	});

	// Compares realpaths, not raw strings: os.tmpdir() is /tmp on macOS, a
	// symlink to /private/tmp that the spawned shell resolves before
	// reporting process.cwd(), so the raw strings never match there.
	test('runs in the given cwd', async () => {
		const result = await runShellCommand('node -e "console.log(process.cwd())"', os.tmpdir());

		assert.strictEqual(fs.realpathSync(result.stdout.trim()), fs.realpathSync(os.tmpdir()));
	});
});
