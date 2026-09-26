#!/usr/bin/env node
/**
 * Restore hard-link fallbacks for Android, where sepolicy denies link(2).
 *
 * On this Termux filesystem link(2) fails with EACCES/EPERM everywhere (the
 * kernel policy blocks it; it is not a filesystem-format limit). dsh 0.1.0-rc.7
 * carried an explicit workaround for exactly this, commented
 *   "Android sepolicy blocks link(2) (EACCES/EPERM); fall back to
 *    same-filesystem atomic rename"
 * and the 0.1.7 rewrite dropped it, so session creation dies with EACCES.
 *
 * All four sites that publish through link(2) get a fallback that preserves
 * each call's own contract:
 *   - session materialize / attachment staged publish: rename (link + unlink of
 *     the staged name is exactly what rename does);
 *   - exclusive generation publish: O_EXCL claim + copy, because there link(2)
 *     is used as "publish only if absent" and a bare rename would clobber.
 *
 * Idempotent, and it refuses to guess: every anchor must match exactly once.
 */
const fs = require('node:fs');
const path = require('node:path');

function resolveFile (pkg, rel) {
  return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
}

const SP = resolveFile('@deepseek-ai/dsh-session-persistence-jsonl', 'lib/index.js');
const AL = resolveFile('@deepseek-ai/dsh-attachment-local', 'lib/index.js');

const ANDROID_NOTE = '/* Android sepolicy blocks link(2) (EACCES/EPERM);';

const EDITS = [
  {
    file: SP,
    label: 'session-persistence: import rename',
    from: 'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, truncate } from "node:fs/promises";',
    to: 'import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, truncate } from "node:fs/promises";',
  },
  {
    file: SP,
    label: 'session-persistence: materialize falls back to rename',
    from: '\t\t\tawait link(tmp, finalPath);\n\t\t\tlinked = true;\n\t\t} finally {',
    to: '\t\t\tawait link(tmp, finalPath);\n\t\t\tlinked = true;\n\t\t} catch (error) {\n\t\t\t' + ANDROID_NOTE + ' fall back to same-filesystem atomic rename */\n\t\t\tif (error?.code === "EACCES" || error?.code === "EPERM") await rename(tmp, finalPath);\n\t\t\telse throw error;\n\t\t} finally {',
  },
  {
    file: SP,
    label: 'session-persistence: exclusive publish falls back to O_EXCL + copy',
    from: '\t\tawait internals.fs.link(staged, currentPath);\n\t} catch (error) {\n\t\t/* v8 ignore else -- a non-collision filesystem error propagates unchanged. */\n\t\tif (isEEXIST(error)) return false;',
    to: '\t\tawait internals.fs.link(staged, currentPath);\n\t} catch (error) {\n\t\t/* v8 ignore else -- a non-collision filesystem error propagates unchanged. */\n\t\tif (isEEXIST(error)) return false;\n\t\tif (error?.code === "EACCES" || error?.code === "EPERM") {\n\t\t\t' + ANDROID_NOTE + ' keep the exclusive-publish contract via O_EXCL + copy. */\n\t\t\tlet claim;\n\t\t\ttry {\n\t\t\t\tclaim = await internals.fs.open(currentPath, "wx", 384);\n\t\t\t} catch (claimError) {\n\t\t\t\tif (isEEXIST(claimError)) return false;\n\t\t\t\tthrow claimError;\n\t\t\t}\n\t\t\ttry {\n\t\t\t\tawait claim.writeFile(await internals.fs.readFile(staged));\n\t\t\t\tawait claim.sync();\n\t\t\t} catch (writeError) {\n\t\t\t\tawait claim.close();\n\t\t\t\tawait internals.fs.rm(currentPath);\n\t\t\t\tthrow writeError;\n\t\t\t}\n\t\t\tawait claim.close();\n\t\t\tawait internals.fs.rm(staged);\n\t\t\tawait syncDirectory(dirname(currentPath), internals);\n\t\t\treturn true;\n\t\t}',
  },
  {
    file: AL,
    label: 'attachment-local: import copyFile',
    from: 'import { chmod, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
    to: 'import { chmod, copyFile, link, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";',
  },
  {
    file: AL,
    label: 'attachment-local: alias publish falls back to exclusive copy',
    from: '\t\t\tawait link(source, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;',
    to: '\t\t\tawait link(source, target);\n\t\t} catch (error) {\n\t\t\tif (error?.code === "EACCES" || error?.code === "EPERM") {\n\t\t\t\t' + ANDROID_NOTE + ' publish the alias by exclusive copy instead. */\n\t\t\t\ttry {\n\t\t\t\t\tawait copyFile(source, target, constants.COPYFILE_EXCL);\n\t\t\t\t} catch (copyError) {\n\t\t\t\t\tif (copyError?.code !== "EEXIST") throw copyError;\n\t\t\t\t}\n\t\t\t} else {\n\t\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\t}',
  },
  {
    file: AL,
    label: 'attachment-local: staged publish falls back to exclusive copy',
    from: '\t\t\tawait link(staged.path, target);\n\t\t} catch (error) {\n\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;',
    to: '\t\t\tawait link(staged.path, target);\n\t\t} catch (error) {\n\t\t\tif (error?.code === "EACCES" || error?.code === "EPERM") {\n\t\t\t\t' + ANDROID_NOTE + ' publish the object by exclusive copy instead. */\n\t\t\t\ttry {\n\t\t\t\t\tawait copyFile(staged.path, target, constants.COPYFILE_EXCL);\n\t\t\t\t} catch (copyError) {\n\t\t\t\t\tif (copyError?.code !== "EEXIST") throw copyError;\n\t\t\t\t}\n\t\t\t} else {\n\t\t\t\t/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */\n\t\t\t\tif (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;\n\t\t\t}',
  },
];

const cache = new Map();
function read (file) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(file, 'utf8'));
  return cache.get(file);
}

let applied = 0;
const failed = [];

for (const edit of EDITS) {
  let source = read(edit.file);
  if (source.includes(edit.to)) {
    console.log(`hardlink patch: already applied (${edit.label})`);
    continue;
  }
  const hits = source.split(edit.from).length - 1;
  if (hits !== 1) {
    failed.push(`${edit.label} (anchor matched ${hits} times)`);
    continue;
  }
  const next = source.replace(edit.from, edit.to);
  cache.set(edit.file, next);
  fs.writeFileSync(edit.file, next);
  applied += 1;
  console.log(`hardlink patch: applied (${edit.label})`);
}

if (failed.length > 0) {
  console.error('\nhardlink patch: could not patch:');
  for (const f of failed) console.error(`  - ${f}`);
  console.error('upstream wording changed; refusing to leave a half-patched tree');
  process.exit(1);
}
console.log(`hardlink patch: ${applied} edit(s) written`);
