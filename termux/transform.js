// Rewrite an upstream @deepseek-ai/dsh manifest into the vendored Termux build.
//
// Termux adaptations, in order of importance:
//   1. bin -> lib/termux-bin.js, which re-execs Node with --expose-internals
//      (upstream's boot reaches Node internals through a native addon that has
//      no android/arm64 binding).
//   2. overrides -> vendor/node-addon-require-builtin, a shim that serves Node
//      internals via --expose-internals when no native binding exists.
//   3. @img/sharp-wasm32 as a direct dependency: @deepseek-ai/dsh-attachment-local
//      pulls sharp, whose prebuilt binaries have no android/arm64 target.
//   4. name/version/description rebrand, bundleDependencies for a self-contained pack.
const fs = require('fs'), path = require('path');
const dest = process.argv[2];
const upstream = process.argv[3];
const rev = process.argv[4] || '1';
const name = 'dsh-termux';

const mf = path.join(dest, 'package.json');
const p = JSON.parse(fs.readFileSync(mf, 'utf8'));

p.name = name;
p.version = `${upstream}-termux.${rev}`;
if (!/vendored Termux build/.test(p.description || '')) {
  p.description = `${p.description} (vendored Termux build)`;
}

// (1) Termux launcher
p.bin = { dsh: 'lib/termux-bin.js', [name]: 'lib/termux-bin.js' };
const files = new Set(p.files || []);
files.add('lib/termux-bin.js');
files.add('vendor');
p.files = [...files];

// (2) native-internals shim. `node-addon-require-builtin` is a DIRECT dependency
// of upstream dsh, and npm refuses an override whose spec differs from the direct
// dependency's, so the direct dependency itself is repointed and the override
// (for transitive copies) repeats the identical spec.
const SHIM_SPEC = 'file:./vendor/node-addon-require-builtin';
p.dependencies = p.dependencies || {};
p.dependencies['node-addon-require-builtin'] = SHIM_SPEC;
p.overrides = Object.assign({}, p.overrides, {
  'node-addon-require-builtin': SHIM_SPEC,
});

// (2b) real flock on Android. dsh-session-persistence-jsonl (>=0.1.5) takes its
// session write lease through @deepseek-ai/node-addon-system/flock, which has no
// android build and gates the binding to linux/darwin. A Node-API flock addon is
// compiled from the public upstream source and vendored as the platform package
// this host's name resolves to; patch-flock.cjs then teaches flock.js about
// android. Without it no dsh session can be created on Termux.
p.dependencies['@deepseek-ai/node-addon-system-android-arm64'] =
  'file:./vendor/node-addon-system-android-arm64';

// (3) sharp wasm32 fallback
let sharpSpec = null;
const al = path.join(dest, 'node_modules', '@deepseek-ai', 'dsh-attachment-local', 'package.json');
if (fs.existsSync(al)) {
  sharpSpec = (JSON.parse(fs.readFileSync(al, 'utf8')).dependencies || {}).sharp || null;
}
if (!sharpSpec) sharpSpec = '^0.35.3';
p.dependencies = p.dependencies || {};
p.dependencies['@img/sharp-wasm32'] = sharpSpec;

// (4) bundleDependencies mirrors the original vendored build. It is cosmetic --
// `npm pack` can never yield a working artifact for this package, because npm
// bundles only `dependencies` and never `devDependencies`, while the packages a
// profile bundle actually resolves to (dsh-host-webserver, dsh-session-persistence,
// dsh-llm-deepseek, ...) are devDependencies. Deploy the built TREE instead; see
// install-termux.sh.
p.bundleDependencies = Object.keys(p.dependencies).sort();

fs.writeFileSync(mf, JSON.stringify(p, null, 2) + '\n');
console.log(`  name         : ${p.name}`);
console.log(`  version      : ${p.version}`);
console.log(`  bin          : ${JSON.stringify(p.bin)}`);
console.log(`  files        : ${JSON.stringify(p.files)}`);
console.log(`  overrides    : ${JSON.stringify(p.overrides)}`);
console.log(`  sharp        : ${sharpSpec} -> @img/sharp-wasm32`);
console.log(`  dependencies : ${Object.keys(p.dependencies).length}`);
console.log(`  devDeps      : ${Object.keys(p.devDependencies || {}).length}`);
