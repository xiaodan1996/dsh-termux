#!/data/data/com.termux/files/usr/bin/node
/**
 * Termux launcher for the vendored dsh build.
 *
 * Why this exists
 * ---------------
 * `@deepseek-ai/dsh-app-boot` installs a profile module-resolution interception
 * by patching Node's internal ESM and CommonJS resolvers, and reaches those
 * resolvers through the prebuilt native addon `node-addon-require-builtin`.
 * That addon publishes no android/arm64 binding, so the call throws and boot
 * aborts with "host preparation failed".
 *
 * Node's own `--expose-internals` flag exposes the same internal module objects
 * to plain `require`, but the flag is rejected in NODE_OPTIONS, so it can only be
 * given on the command line. This launcher re-execs Node once with the flag and
 * the real entry (`./bin.js`) as the main module; the vendored
 * `node-addon-require-builtin` shim then serves internals through plain require.
 *
 * `./bin.js` must be the MAIN module: it guards its body with
 * `if (import.meta.main)`, so importing it instead of executing it silently
 * does nothing.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FLAG = '--expose-internals';
const entry = fileURLToPath(new URL('./bin.js', import.meta.url));

// Forward any other node flags the user supplied, but never the one we add.
const passthrough = process.execArgv.filter(arg => arg !== FLAG);

const result = spawnSync(
  process.execPath,
  [FLAG, ...passthrough, entry, ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);

if (result.error) {
  console.error(`dsh (termux): failed to re-exec with ${FLAG}: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
  process.exit(128);
}
process.exit(result.status ?? 1);
