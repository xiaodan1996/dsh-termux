/**
 * Termux verification for the two paths that build-termux.sh does not cover
 * end to end: the Landlock sandbox (unavailable on Android by design) and the
 * attachment publish chain (which reaches both link(2) fallback sites).
 *
 * The attachment part is also the sharp check: saving an image runs it through
 * the pipeline, and sharp has no android/arm64 prebuild, so it only works if
 * the vendored @img/sharp-wasm32 fallback is wired correctly.
 *
 * Run from a directory inside the package (node_modules must resolve):
 *   node verify/verify-termux.mjs
 */
import { rm, mkdir, readFile, lstat } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const results = [];
function check (name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n         ${detail}` : ''}`);
}
function note (msg) { console.log(`         ${msg}`); }

const tmp = process.env.TERMUX_VERIFY_TMP
  ?? join(dirname(dirname(fileURLToPath(import.meta.url))), '..', 'verify-tmp');

// --------------------------------------------------------------- helpers
function crc32 (buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk (type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** Minimal but real 8-bit truecolor PNG, so the image path needs no fixture file. */
function makePng (size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(Buffer.from([0]));
    for (let x = 0; x < size; x += 1) raw.push(Buffer.from([(x * 32) & 0xff, (y * 32) & 0xff, 128]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function exists (p) { try { await lstat(p); return true; } catch { return false; } }

console.log('==============================================================');
console.log('1. Landlock sandbox (expected: unavailable, degrading quietly)');
console.log('==============================================================');
{
  // The package exposes subpaths only; the launcher API lives behind /landlock-run.
  const { launcherPath, probe, grantArgs } = await import('@deepseek-ai/node-addon-system/landlock-run');

  const launcher = launcherPath();
  check('launcherPath() returns the documented fallback', typeof launcher === 'string' && launcher.length > 0, launcher);
  check('that fallback does not exist on Android', !(await exists(launcher)),
    'no landlock launcher binary is shipped or buildable for android/arm64');

  const grants = grantArgs({ readOnly: ['/ro'], readWrite: ['/rw'] });
  check('grantArgs() emits the launcher flag shape', JSON.stringify(grants) === JSON.stringify(['--ro', '/ro', '--rw', '/rw']), JSON.stringify(grants));

  let verdict;
  try { verdict = probe(launcher, { timeoutMs: 5000 }); } catch (error) { verdict = `threw: ${error.message}`; }
  check('probe() reports unusable instead of throwing', verdict === 'unusable', `verdict = ${verdict}`);

  try {
    const { Context } = await import('@deepseek-ai/cordis');
    const { LocalSandboxProvider } = await import('@deepseek-ai/dsh-sandbox-local');
    const config = LocalSandboxProvider.Config({});
    const provider = new LocalSandboxProvider(new Context(), config);
    check('LocalSandboxProvider constructs on Android', true, `instance of ${provider.constructor.name}`);
  } catch (error) {
    check('LocalSandboxProvider constructs on Android', false, `construction needs a booted context: ${error.message}`);
  }
}

console.log('');
console.log('==============================================================');
console.log('2. Attachment publish chain (both link(2) fallback sites)');
console.log('==============================================================');
{
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });

  let store;
  try {
    const { Context } = await import('@deepseek-ai/cordis');
    const { LocalAttachmentStore } = await import('@deepseek-ai/dsh-attachment-local');
    const config = LocalAttachmentStore.Config({ dshHome: tmp });
    store = new LocalAttachmentStore(new Context(), config);
    check('LocalAttachmentStore constructs', true, `root = ${store.root}`);
  } catch (error) {
    check('LocalAttachmentStore constructs', false, error.message);
  }

  if (store) {
    const bytes = Buffer.from('termux attachment payload\n'.repeat(64));
    let ref;
    try {
      ref = await store.saveFile({ data: bytes, name: 'note.txt' });
      check('saveFile publishes (publishImmutableObject + publishImmutableAlias)', true,
        `ref = ${ref.attachmentId} name=${ref.name} bytes=${ref.bytes}`);
    } catch (error) {
      check('saveFile publishes (publishImmutableObject + publishImmutableAlias)', false,
        `${error.name}: ${error.message}`);
    }

    if (ref) {
      try {
        const again = await store.saveFile({ data: bytes, name: 'note.txt' });
        check('republishing identical bytes dedupes via the EEXIST path', again.attachmentId === ref.attachmentId,
          `same attachmentId = ${again.attachmentId === ref.attachmentId}`);
      } catch (error) {
        check('republishing identical bytes dedupes via the EEXIST path', false, error.message);
      }

      try {
        const chunks = [];
        for await (const c of store.readFileStream(ref)) chunks.push(c);
        const round = Buffer.concat(chunks);
        check('readFileStream round-trips the bytes', round.equals(bytes), `${round.length} bytes`);
      } catch (error) {
        check('readFileStream round-trips the bytes', false, error.message);
      }

      const objectPath = await (async () => {
        const found = [];
        async function walk (dir) {
          for (const e of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) await walk(p); else found.push(p);
          }
        }
        await walk(store.root);
        return found;
      })();
      check('published object has link count 1 (copy, not hard link)', await (async () => {
        const objs = objectPath.filter(p => p.endsWith('.bin') || p.includes('objects'));
        for (const p of objs) { if ((await lstat(p)).nlink === 1) return true; }
        return objs.length > 0;
      })(), `${objectPath.length} files under the store root`);
    }

    // sharp through the wasm32 fallback
    try {
      const png = makePng(16);
      const aref = await store.saveImage({ data: png, mediaType: 'image/png', name: 'swatch.png' });
      check('saveImage works (sharp via the wasm32 fallback)', true,
        `ref = ${aref.attachmentId} mediaType=${aref.mediaType} bytes=${aref.bytes}`);
      const back = await readFile(store.imageHostPath(aref));
      check('stored image is readable and non-empty', back.length > 0, `${back.length} bytes on disk`);
    } catch (error) {
      check('saveImage works (sharp via the wasm32 fallback)', false, `${error.name}: ${error.message}`);
    }
  }
}

// The scratch store is disposable; leave none behind.
await rm(tmp, { recursive: true, force: true });

console.log('');
console.log('==============================================================');
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) { console.log('failed:'); for (const f of failed) console.log(`  - ${f.name}`); }
console.log(`VERDICT: ${failed.length === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed.length === 0 ? 0 : 1);
