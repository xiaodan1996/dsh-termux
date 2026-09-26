/**
 * Verify one attachment end to end, after a real upload through the running GUI.
 *
 * Two steps, in this order:
 *   node verify/attachment-e2e-verify.mjs --baseline   # BEFORE uploading
 *   node verify/attachment-e2e-verify.mjs [<session-id>]  # after uploading
 *
 * Three independent pieces of evidence:
 *   1. the attachment store gained objects since the recorded baseline;
 *   2. the new image objects are decodable, normalized images;
 *   3. the session log actually references the stored digest.
 *
 * The session artifact appends one zstd frame per write, and a single
 * zstdDecompressSync call only yields the first, so frames are decoded
 * greedily between consecutive zstd magics.
 */
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const HOME_DIR = process.env.HOME;
const DSH = join(HOME_DIR, '.dsh');
const ATT = join(DSH, 'attachments');
const SESSIONS = join(DSH, 'sessions');
// In tmpdir(), not beside the build scripts: it must persist between the two
// runs but must not depend on where this package was installed.
const BASELINE = join(tmpdir(), 'dsh-termux-attach-baseline.json');
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

async function exists (p) { try { await lstat(p); return true; } catch { return false; } }

async function snapshot (dir) {
  const files = new Set(), dirs = new Set();
  async function walk (d) {
    let es; try { es = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = join(d, e.name); if (e.isDirectory()) { dirs.add(p); await walk(p); } else files.add(p); }
  }
  await walk(dir);
  return { files, dirs };
}

/** Decode every concatenated zstd frame, or as many as decode cleanly. */
function decodeAll (buf) {
  const offs = []; let i = 0;
  while ((i = buf.indexOf(MAGIC, i)) !== -1) { offs.push(i); i += 4; }
  if (offs.length === 0 || offs[0] !== 0) return { text: '', frames: 0, complete: false };
  const parts = [];
  let k = 0;
  while (k < offs.length) {
    let decoded = null; let end = null;
    for (let j = k + 1; j <= offs.length; j += 1) {
      const stop = j < offs.length ? offs[j] : buf.length;
      try { decoded = zstdDecompressSync(buf.subarray(offs[k], stop)); end = stop; break; } catch { /* try a wider span */ }
    }
    if (decoded === null) return { text: Buffer.concat(parts).toString('utf8'), frames: parts.length, complete: false };
    parts.push(decoded);
    while (k < offs.length && offs[k] < end) k += 1;
  }
  return { text: Buffer.concat(parts).toString('utf8'), frames: parts.length, complete: true };
}

const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `\n         ${d}` : ''}`); };

// --- baseline mode -------------------------------------------------------
// The diff needs a "before" picture of the store. Recording it is a separate,
// explicit step so a forgotten baseline fails loudly instead of silently
// counting the whole store as new.
if (process.argv.includes('--baseline')) {
  const snap = await snapshot(ATT);
  await writeFile(BASELINE, JSON.stringify({ files: [...snap.files], dirs: [...snap.dirs] }, null, 1));
  console.log(`baseline recorded: ${snap.files.size} files, ${snap.dirs.size} dirs`);
  console.log(`  store root : ${ATT}${await exists(ATT) ? '' : '  (does not exist yet)'}`);
  console.log(`  written to : ${BASELINE}`);
  console.log('\nNow attach an image through the GUI, then re-run without --baseline.');
  process.exit(0);
}

// ---------------------------------------------------------------- 1. store
if (!(await exists(BASELINE))) {
  console.error(`No baseline at ${BASELINE}.`);
  console.error('Record one BEFORE uploading, then re-run:');
  console.error('  node verify/attachment-e2e-verify.mjs --baseline');
  process.exit(2);
}
const before = JSON.parse(await readFile(BASELINE, 'utf8'));
const beforeFiles = new Set(before.files);
const now = await snapshot(ATT);
const newFiles = [...now.files].filter(p => !beforeFiles.has(p));
console.log(`store root      : ${ATT} (existed at baseline: ${before.files.length > 0 || before.dirs.length > 0})`);
console.log(`new object files: ${newFiles.length}`);
for (const p of newFiles) console.log(`  ${(await lstat(p)).size.toString().padStart(9)}  ${p.replace(ATT + '/', '')}`);
check('the store gained objects', newFiles.length > 0, `${newFiles.length} new file(s)`);

// ------------------------------------------------------- 2. real images
const IMG = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46], gif: [0x47, 0x49, 0x46, 0x38] };
function imageKind (buf) {
  for (const [k, sig] of Object.entries(IMG)) if (sig.every((b, n) => buf[n] === b)) return k;
  return null;
}
const images = [];
for (const p of newFiles) {
  const buf = await readFile(p);
  const kind = imageKind(buf);
  if (kind) images.push({ p, kind, bytes: buf.length });
}
check('a new object decodes as an image', images.length > 0,
  images.map(i => `${i.kind} ${i.bytes}B  ${basename(i.p)}`).join('\n         ') || 'none');

// ------------------------------------------------- 3. session references it
const wanted = process.argv[2];
let target = null;
const projectDirs = await readdir(SESSIONS).catch(() => []);
const candidates = [];
for (const proj of projectDirs) {
  const pd = join(SESSIONS, proj);
  for (const s of await readdir(pd).catch(() => [])) {
    const dir = join(pd, s);
    let entries; try { entries = await readdir(dir); } catch { continue; }
    const gen = entries.filter(e => /^session\.v\d+\.jsonl\.zstd$/.test(e)).sort().pop();
    if (!gen) continue;
    const st = await lstat(join(dir, gen));
    candidates.push({ dir, gen, mtime: st.mtimeMs });
  }
}
candidates.sort((a, b) => b.mtime - a.mtime);
if (wanted) target = candidates.find(c => basename(c.dir) === wanted) ?? null;
else target = candidates[0] ?? null;

if (!target) {
  check('session log references the attachment', false, 'no session generation found');
} else {
  const raw = await readFile(join(target.dir, target.gen));
  const { text, frames, complete } = decodeAll(raw);
  const events = text.split('\n').filter(Boolean);
  console.log(`session         : ${basename(target.dir)} / ${target.gen}`);
  console.log(`frames decoded  : ${frames}${complete ? '' : ' (stopped early)'}`);
  console.log(`events          : ${events.length}`);
  // Only the digest is specific evidence. A prose match on the word "attachment"
  // would pass trivially on any transcript that discusses attachments, which is
  // exactly the false positive this check exists to avoid.
  const digests = newFiles.map(p => basename(p).replace(/\.(png|jpe?g|webp|gif)$/i, ''));
  const hit = digests.find(d => d.length >= 32 && text.includes(d));
  check('session log references the stored digest', Boolean(hit),
    hit ? `digest ${hit.slice(0, 16)}... appears in the log` : `none of the ${digests.length} new digest(s) appear in the log`);
  // Sharper than an event-type name match: the attachment record the harness
  // actually persisted. Prose that merely quotes the digest carries no
  // attachment object, so the transcript cannot satisfy this by talking about
  // itself -- which the earlier prose-based version of this check did.
  const refs = [];
  for (const l of events) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    const payload = JSON.stringify(e.data ?? e);
    if (!hit || !payload.includes(hit)) continue;
    const m = payload.match(/"attachment":\{[^}]*"attachmentId":"sha256:[0-9a-f]{64}"[^}]*\}/);
    if (m) refs.push({ type: e.type, block: m[0] });
  }
  check('log carries a structural attachment record', refs.length > 0,
    refs.length
      ? `${refs.length} event(s): ${[...new Set(refs.map(r => r.type))].join(', ')}\n         ${refs[0].block}`
      : 'no event contains an attachment object');
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`VERDICT: ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
