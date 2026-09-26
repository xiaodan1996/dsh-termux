/**
 * Probe the flock binding: acquire a real kernel lease on a scratch file.
 *
 * Uses os.tmpdir() rather than a build-workspace path so it works from any
 * install location. Exits non-zero when the lease cannot be taken, so callers
 * that chain it with `|| die` actually fail.
 */
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock';

const p = join(tmpdir(), 'dsh-termux-flock-probe.lock');
const f = await open(p, 'w');
let ok = false;
try {
  await tryLockExclusive(f.fd);
  ok = true;
  console.log('RESULT: flock acquired OK');
} catch (error) {
  console.log('RESULT: flock FAILED ->', error.code, '|', error.message);
} finally {
  await f.close();
}
process.exit(ok ? 0 : 1);
