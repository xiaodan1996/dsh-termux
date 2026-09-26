/**
 * Keyless end-to-end check of the Termux build: run the real headless agent
 * against the scripted mock LLM server, so the whole loop (profile boot, module
 * interception, session create + flock lease, hardlink-free publish, streaming
 * response) executes on this device without touching any real provider key.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server';

const MARKER = 'PONG-FROM-MOCK-LLM';
// Locate the package root by walking up, so these checks run from the package
// root or from verify/ alike.
function packageRoot (from) {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'lib', 'bin.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('dsh-termux package root not found');
    dir = parent;
  }
}
const packageDir = packageRoot(dirname(fileURLToPath(import.meta.url)));
const launcher = join(packageDir, 'lib', 'termux-bin.js');
// A throwaway DSH_HOME beside the package, never the caller's real ~/.dsh. A
// caller-supplied DSH_HOME is respected and left alone.
const inheritedHome = process.env.DSH_HOME;
const home = inheritedHome ?? join(packageDir, '..', 'verify-home');

const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText: MARKER,
});
console.log(`mock llm listening at ${server.baseURL}`);

// The mock server lives in THIS process, so the child must be spawned
// asynchronously: spawnSync would block the event loop and the mock could never
// answer, deadlocking the run.
const child = spawn(
  process.execPath,
  [launcher, '--profile', 'headless', 'say hi'],
  {
    env: {
      ...process.env,
      DSH_HOME: home,
      DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
      DEEPSEEK_API_KEY: 'mock-key',
    },
  },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const result = await new Promise((resolve) => {
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 180_000);
  child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal }); });
});

await server.close();
if (inheritedHome === undefined) await rm(home, { recursive: true, force: true });

console.log('--- dsh headless stdout ---');
console.log(stdout.trim());
if (stderr.trim()) {
  console.log('--- dsh headless stderr ---');
  console.log(stderr.trim());
}
console.log('--- mock server saw ---');
console.log(`requests: ${server.requests.length}`);
for (const r of server.requests) console.log(`  attempt ${r.attempt}: ${r.behavior} -> ${r.outcome}`);

const sawMarker = stdout.includes(MARKER);
console.log('---------------------------------------------');
console.log(`exit code     : ${result.status} (signal ${result.signal})`);
console.log(`marker echoed : ${sawMarker}`);
console.log(`VERDICT       : ${sawMarker && result.status === 0 ? 'PASS' : 'FAIL'}`);
process.exit(sawMarker && result.status === 0 ? 0 : 1);
