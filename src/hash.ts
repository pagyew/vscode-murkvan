import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const HASH_ALGORITHM = 'sha1';

/**
 * Hashes a file's contents.
 *
 * Runs in-process instead of shelling out to `md5`, which only exists on
 * macOS/BSD and made the extension throw on Linux and Windows.
 *
 * @returns the hex digest, or `undefined` when the file cannot be read.
 */
export async function hashFile(filePath: string): Promise<string | undefined> {
	try {
		const hash = createHash(HASH_ALGORITHM);

		for await (const chunk of createReadStream(filePath)) {
			hash.update(chunk);
		}

		return hash.digest('hex');
	} catch {
		return undefined;
	}
}
