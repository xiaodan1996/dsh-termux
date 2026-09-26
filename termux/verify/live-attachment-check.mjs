/**
 * Confirm the attachment fix against the REAL ~/.dsh.
 *
 * NOTE: unlike the other checks this one writes to the live DSH_HOME. It records
 * every file AND directory present beforehand, removes only what it created
 * (deepest first), and asserts the store tree is left exactly as found -- but it
 * does touch real state, so run it deliberately rather than in a routine loop.
 *
 * The deployed tree's modules are imported by absolute path so this script can
 * live outside the install and leave the verified tree untouched. Run it once
 * the build is installed globally:
 *
 *   node verify/live-attachment-check.mjs
 *
 * Before the durable-walk fix this fails with
 *   EACCES: permission denied, open '/data/data'
 */
import { lstat, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const G = '/data/data/com.termux/files/usr/lib/node_modules/dsh-termux';
const DSH = join(process.env.HOME, '.dsh');
const ATT = join(DSH, 'attachments');

const { Context } = await import(join(G, 'node_modules/@deepseek-ai/cordis/lib/index.js'));
const { LocalAttachmentStore } = await import(join(G, 'node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js'));

function crc32 (buf) { let crc = 0xffffffff; for (const b of buf) { let c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk (t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b)); return Buffer.concat([l, b, c]); }
function png (n) { const h = Buffer.alloc(13); h.writeUInt32BE(n, 0); h.writeUInt32BE(n, 4); h[8] = 8; h[9] = 2; const raw = []; for (let y = 0; y < n; y++) { raw.push(Buffer.from([0])); for (let x = 0; x < n; x++) raw.push(Buffer.from([(x * 40) & 0xff, (y * 40) & 0xff, 200])); } return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR', h), chunk('IDAT', deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0))]); }

/** Every file and directory below `dir`; the store creates directories too, so a file-only snapshot would under-report. */
async function snapshot (dir) {
  const files = new Set(); const dirs = new Set();
  async function walk (d) {
    let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { dirs.add(p); await walk(p); } else { files.add(p); }
    }
  }
  await walk(dir);
  return { files, dirs };
}

/** The store root itself is created on first use, so its own existence is part of "as found". */
async function exists (p) { try { await lstat(p); return true; } catch { return false; } }

const attExisted = await exists(ATT);
const before = await snapshot(ATT);
console.log(`DSH_HOME      : ${DSH}`);
console.log(`store root    : ${join(ATT, 'v1')}`);
console.log(`pre-existing  : ${before.files.size} files, ${before.dirs.size} dirs (store root existed: ${attExisted})`);

const ctx = new Context();
const store = new LocalAttachmentStore(ctx, LocalAttachmentStore.Config({ dshHome: DSH }));
console.log(`resolved root : ${store.root}`);

const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `\n         ${d}` : ''}`); };

try {
  const ref = await store.saveImage({ data: png(24), mediaType: 'image/png', name: 'live-check.png' });
  check('saveImage against the real ~/.dsh', true, `${ref.attachmentId} (${ref.bytes} bytes)`);
  const back = await readFile(store.imageHostPath(ref));
  check('stored image reads back', back.length === ref.bytes, `${back.length} bytes`);
  const fref = await store.saveFile({ data: Buffer.from('live attachment check\n'), name: 'live-check.txt' });
  const chunks = []; for await (const c of store.readFileStream(fref)) chunks.push(c);
  check('saveFile + readFileStream round-trip', Buffer.concat(chunks).toString() === 'live attachment check\n', fref.attachmentId);
} catch (error) {
  check('attachment publish against the real ~/.dsh', false, `${error.name}: ${error.message}`);
}

const after = await snapshot(ATT);
const newFiles = [...after.files].filter(p => !before.files.has(p));
const newDirs = [...after.dirs].filter(p => !before.dirs.has(p));
console.log(`\ncreated ${newFiles.length} file(s) and ${newDirs.length} dir(s); removing them`);
if (attExisted) {
  for (const p of newFiles) await rm(p, { force: true });
  for (const p of newDirs.sort((a, b) => b.length - a.length)) await rmdir(p).catch(() => {});
} else {
  // Nothing under the root predates this run, so the whole tree is ours.
  await rm(ATT, { recursive: true, force: true });
}

const rootStillThere = await exists(ATT);
const final = await snapshot(ATT);
const leftovers = (rootStillThere === attExisted ? 0 : 1)
  + [...final.files].filter(p => !before.files.has(p)).length
  + [...final.dirs].filter(p => !before.dirs.has(p)).length;
check('live store left exactly as found (root, files and dirs)', leftovers === 0,
  `store root existed ${attExisted} before, ${rootStillThere} after; 0 leftovers expected`);

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(`VERDICT: ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
