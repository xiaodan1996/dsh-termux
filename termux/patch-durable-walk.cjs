#!/usr/bin/env node
/**
 * Stop the attachment durable-ancestor walk at the highest reachable ancestor.
 *
 * `dsh-attachment-local` proves durability by fsyncing every ancestor of
 * $DSH_HOME up to the filesystem root:
 *
 *   ensureDurableHome(path) -> ensureDurableDirectory(home, parse(home).root)
 *
 * Android denies /, /data and /data/data to app sandboxes (they are system-owned
 * and not read-permitted), so the walk dies with EACCES at /data/data and no
 * attachment can ever be saved -- images and files alike. dsh 0.1.0-rc.7 carries
 * the identical code, so this predates 0.1.7 and is not a regression from it.
 *
 * The fix bounds the walk by what the process can actually open. Everything
 * above that point is root-owned and already durable, and it is not this
 * process's to sync; every entry the process does own is still fsynced exactly
 * as before. `ensureDurableHome` is the only caller that passes the filesystem
 * root as a boundary, so the change is confined to it.
 *
 * Idempotent, and it refuses to patch if the anchor drifts.
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(
  path.dirname(require.resolve('@deepseek-ai/dsh-attachment-local/package.json')),
  'lib',
  'index.js',
);

const FROM =
  'async function ensureDurableHome(path) {\n' +
  '\tconst home = resolve(path);\n' +
  '\tif (!durableHomes.has(home)) {\n' +
  '\t\tawait ensureDurableDirectory(home, parse(home).root);\n' +
  '\t\tdurableHomes.add(home);\n' +
  '\t}\n' +
  '\treturn home;\n' +
  '}';

const TO =
  '/**\n' +
  '* Highest ancestor this process can actually open for fsync.\n' +
  '*\n' +
  '* Android denies /, /data and /data/data to app sandboxes, so the filesystem\n' +
  '* root is not a reachable durable boundary there: the ancestor walk dies with\n' +
  '* EACCES before it reaches any entry this process owns. Stopping at the highest\n' +
  '* reachable ancestor keeps the durability proof on exactly the entries the\n' +
  '* process can make durable; everything above is root-owned and already durable.\n' +
  '* @param home - absolute DSH_HOME (or a descendant used as one).\n' +
  '* @returns the highest ancestor that can be opened, never above `home`.\n' +
  '*/\n' +
  'async function durableHomeBoundary(home) {\n' +
  '\tlet level = home;\n' +
  '\tfor (;;) {\n' +
  '\t\tconst parent = dirname(level);\n' +
  '\t\tif (parent === level) return level;\n' +
  '\t\ttry {\n' +
  '\t\t\tconst handle = await open(parent, constants.O_RDONLY);\n' +
  '\t\t\tawait handle.close();\n' +
  '\t\t} catch {\n' +
  '\t\t\treturn level;\n' +
  '\t\t}\n' +
  '\t\tlevel = parent;\n' +
  '\t}\n' +
  '}\n' +
  'async function ensureDurableHome(path) {\n' +
  '\tconst home = resolve(path);\n' +
  '\tif (!durableHomes.has(home)) {\n' +
  '\t\tawait ensureDurableDirectory(home, await durableHomeBoundary(home));\n' +
  '\t\tdurableHomes.add(home);\n' +
  '\t}\n' +
  '\treturn home;\n' +
  '}';

const source = fs.readFileSync(target, 'utf8');
if (source.includes('async function durableHomeBoundary(home) {')) {
  console.log('durable-walk patch: already applied');
  process.exit(0);
}
const hits = source.split(FROM).length - 1;
if (hits !== 1) {
  console.error(`durable-walk patch: expected exactly 1 anchor, found ${hits}`);
  console.error(`durable-walk patch: upstream may have changed; refusing to patch ${target}`);
  process.exit(1);
}
fs.writeFileSync(target, source.replace(FROM, TO));
console.log(`durable-walk patch: applied to ${target.replace(/.*node_modules\//, 'node_modules/')}`);
