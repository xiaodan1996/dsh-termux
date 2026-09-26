/**
 * Parameterized keyless end-to-end runner: real profile boot + real agent loop
 * against the scripted mock LLM server.
 *   node e2e-args.mjs <DSH_HOME> <cwd> [dsh args...]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server';

const [home, cwd, ...dshArgs] = process.argv.slice(2);
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
const launcher = join(packageRoot(dirname(fileURLToPath(import.meta.url))), 'lib', 'termux-bin.js');

const server = await startMockLlmServer({ port: 0, sequence: ['success'], repeatLast: true, successText: MARKER });
console.log(`mock llm at ${server.baseURL}  |  DSH_HOME=${home}  cwd=${cwd}`);

const child = spawn(process.execPath, [launcher, ...dshArgs], {
  cwd,
  env: { ...process.env, DSH_HOME: home, DEEPSEEK_BASE_URL: `${server.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key' },
});

let stdout = '', stderr = '';
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', c => { stdout += c; });
child.stderr.on('data', c => { stderr += c; });

const { status, signal } = await new Promise(resolve => {
  const t = setTimeout(() => child.kill('SIGKILL'), 180_000);
  child.on('close', (s, sig) => { clearTimeout(t); resolve({ status: s, signal: sig }); });
});
await server.close();

console.log('--- stdout ---\n' + stdout.trim());
if (stderr.trim()) console.log('--- stderr ---\n' + stderr.trim());
console.log('--- mock llm ---');
console.log(`requests: ${server.requests.length}`);
for (const r of server.requests) console.log(`  attempt ${r.attempt}: ${r.behavior} -> ${r.outcome}`);
console.log(`exit=${status} signal=${signal} marker=${stdout.includes(MARKER)}`);
process.exit(status === 0 ? 0 : 1);
