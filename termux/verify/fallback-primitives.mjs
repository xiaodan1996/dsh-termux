/**
 * Exercise the primitives the Android hard-link fallbacks rely on, against the
 * real filesystem: link(2) must be denied, and the replacement must preserve
 * the exclusivity contract it stands in for.
 */
import { copyFile, link, mkdir, open, readFile, rename, rm, stat, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// os.tmpdir() so the probe runs from any install location, not just the tree
// it happened to be built in.
const base = join(tmpdir(), 'dsh-termux-fallback-probe');
await rm(base, { recursive: true, force: true });
await mkdir(base, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`); };

// 1. the condition the patches exist for
const src = `${base}/staged.bin`;
await (await open(src, 'wx', 0o600)).writeFile('payload-bytes');
let linkCode;
try { await link(src, `${base}/published.bin`); } catch (e) { linkCode = e.code; }
check('link(2) is denied on this filesystem', linkCode !== undefined, `code=${linkCode}`);

// 2. materialize fallback: rename replaces link + rm of the staged name
{
  const staged = `${base}/m.staged`, dst = `${base}/m.final`;
  await (await open(staged, 'wx', 0o600)).writeFile('materialize');
  await rename(staged, dst);
  check('rename publishes and drops the staged name', (await readFile(dst, 'utf8')) === 'materialize' && !(await exists(staged)));
}

// 3. exclusive-publish fallback: O_EXCL claim must still refuse an existing target
{
  const staged = `${base}/e.staged`, dst = `${base}/e.final`;
  await (await open(staged, 'wx', 0o600)).writeFile('exclusive');
  const claim = await open(dst, 'wx', 0o600);
  await claim.writeFile(await readFile(staged));
  await claim.close();
  await rm(staged, { force: true });
  let second;
  try { await open(dst, 'wx', 0o600); } catch (e) { second = e.code; }
  check('O_EXCL claim publishes and refuses a second claim', (await readFile(dst, 'utf8')) === 'exclusive' && second === 'EEXIST', `second=${second}`);
}

// 4. attachment fallback: exclusive copy refuses an existing target
{
  const staged = `${base}/a.staged`, dst = `${base}/a.final`;
  await (await open(staged, 'wx', 0o600)).writeFile('alias');
  await copyFile(staged, dst, constants.COPYFILE_EXCL);
  let second;
  try { await copyFile(staged, dst, constants.COPYFILE_EXCL); } catch (e) { second = e.code; }
  check('COPYFILE_EXCL publishes and refuses an existing target', (await readFile(dst, 'utf8')) === 'alias' && second === 'EEXIST', `second=${second}`);
}

async function exists (p) { try { await stat(p); return true; } catch { return false; } }

await rm(base, { recursive: true, force: true });
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} primitive checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
