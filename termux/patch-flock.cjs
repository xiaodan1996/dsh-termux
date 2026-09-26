#!/usr/bin/env node
/**
 * Teach `@deepseek-ai/node-addon-system/lib/flock.js` about Android.
 *
 * Upstream gates the flock binding to linux/darwin and, on linux, picks the
 * glibc/musl subdirectory from the runtime report. Termux reports
 * process.platform === 'android' with no glibcVersionRuntime, so it is denied
 * the binding even though Android's bionic provides flock(2). Without this,
 * SessionWriteLease.acquire rethrows ERR_FLOCK_UNSUPPORTED_PLATFORM and no dsh
 * session can be created.
 *
 * Two precise textual edits; idempotent, and loud when upstream wording drifts.
 * The binding itself comes from the vendored
 * `@deepseek-ai/node-addon-system-android-arm64` package (bin/musl/system.node,
 * compiled from native/system/packages/entry/src/flock.c).
 */
const fs = require('node:fs');
const path = require('node:path');

// The package's `exports` map does not expose ./lib/flock.js, so locate the
// file through the manifest that IS exported.
const target = path.join(
  path.dirname(require.resolve('@deepseek-ai/node-addon-system/package.json')),
  'lib',
  'flock.js',
);

const EDITS = [
  {
    label: 'platform gate accepts android',
    from: "    if (platform !== 'linux' && platform !== 'darwin') {",
    to: "    if (platform !== 'linux' && platform !== 'darwin' && platform !== 'android') {",
  },
  {
    label: 'libc directory selection covers android',
    from: "    if (platform === 'linux') {",
    to: "    if (platform === 'linux' || platform === 'android') {",
  },
];

let source = fs.readFileSync(target, 'utf8');
let changed = 0;

for (const edit of EDITS) {
  if (source.includes(edit.to)) {
    console.log(`flock patch: already applied (${edit.label})`);
    continue;
  }
  const hits = source.split(edit.from).length - 1;
  if (hits !== 1) {
    console.error(`flock patch: expected exactly 1 occurrence of the anchor for "${edit.label}", found ${hits}`);
    console.error(`flock patch: upstream may have changed; refusing to patch ${target}`);
    process.exit(1);
  }
  source = source.replace(edit.from, edit.to);
  changed += 1;
  console.log(`flock patch: applied (${edit.label})`);
}

if (changed > 0) fs.writeFileSync(target, source);
console.log(`flock patch: ${changed} edit(s) written to ${target}`);
