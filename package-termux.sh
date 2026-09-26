#!/data/data/com.termux/files/usr/bin/bash
#
# Package a built tree as a distributable archive for other Android/arm64 devices.
#
#   ./package-termux.sh [TREE] [ARCH_TAG]
#   ./package-termux.sh stage/dsh-termux android-arm64
#
# Produces, under dist/:
#   <name>.tar.gz          the archive to copy to another device
#   <name>.tar.gz.sha256   its digest
# plus the assembled <name>/ directory it was built from.
#
# The archive is self-contained: the target needs no npm, no compiler and no
# network. It is NOT architecture-neutral -- see termux/DIST-README.md -- so the
# arch tag is part of the filename and the tree's native binaries are checked
# before packing.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$ROOT/termux"
TREE="${1:-$ROOT/stage/dsh-termux}"
ARCH_TAG="${2:-android-arm64}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m   %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

TREE="$(cd "$TREE" && pwd)"
[ -f "$TREE/package.json" ] || die "no package.json in $TREE"
NAME_PKG="$(node -p "require('$TREE/package.json').name")"
[ "$NAME_PKG" = "dsh-termux" ] || die "expected package name dsh-termux, found $NAME_PKG"
VERSION="$(node -p "require('$TREE/package.json').version")"
UPSTREAM="${VERSION%-termux.*}"
NAME="dsh-termux-$VERSION-$ARCH_TAG"

say "packaging $NAME"
printf '    tree     : %s\n' "$TREE"
printf '    version  : %s (upstream %s)\n' "$VERSION" "$UPSTREAM"

# --------------------------------------------- architecture sanity
# The archive carries prebuilt native code, so it is arch-tagged. Blanket-scanning
# every .node file would be wrong: npm packages ship inert prebuilds for other
# platforms (node-pty carries darwin, win32 and linux-x64 builds) that Android
# never resolves to. What matters is the set the runtime actually SELECTS here.
say "checking the native files this host actually selects"
node - "$TREE" <<'NODE'
const fs = require('fs'), path = require('path');
const tree = process.argv[2];
const MACHINE = { 0x3e: 'x86-64', 0xb7: 'aarch64', 0x28: 'arm', 0x03: 'i386' };

function elfArch (p) {
  const b = fs.readFileSync(p);
  if (!(b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46)) return null;
  return MACHINE[b.readUInt16LE(18)] ?? 'unknown';
}

// Selected by package name or by node-pty's platform fallback, not by scanning.
const SELECTED = [
  'node_modules/@esbuild/android-arm64/bin/esbuild',
  'node_modules/@koromix/koffi-android-arm64/android_arm64/koffi.node',
  'node_modules/@deepseek-ai/node-addon-system-android-arm64/bin/musl/system.node',
  'vendor/node-addon-system-android-arm64/bin/musl/system.node',
  'node_modules/node-pty/build/Release/pty.node',
];

const problems = [];
for (const rel of SELECTED) {
  const abs = path.join(tree, rel);
  if (!fs.existsSync(abs)) { problems.push(`${rel} -- MISSING`); continue; }
  const arch = elfArch(abs);
  if (arch === null) { problems.push(`${rel} -- not an ELF binary`); continue; }
  if (arch !== 'aarch64') { problems.push(`${rel} -- ${arch}`); continue; }
  console.log(`    aarch64  ${rel}`);
}

// Informational: how much inert foreign prebuild weight the archive carries.
let foreign = 0;
(function walk (d) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isSymbolicLink()) { try { if (fs.statSync(p).isDirectory()) walk(p); } catch {} }
    else if (e.name.endsWith('.node')) {
      const b = fs.readFileSync(p);
      const isElfAarch64 = b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 && MACHINE[b.readUInt16LE(18)] === 'aarch64';
      if (!isElfAarch64) foreign += 1;
    }
  }
})(path.join(tree, 'node_modules'));
console.log(`    inert foreign prebuilds: ${foreign} (shipped by npm, never resolved on Android)`);

if (problems.length > 0) {
  console.error('    UNUSABLE NATIVE FILES:');
  for (const p of problems) console.error(`        ${p}`);
  process.exit(1);
}
console.log('    every selected native file is aarch64');
NODE
[ $? -eq 0 ] || die "the tree's selected native files are not all aarch64; refusing to tag it $ARCH_TAG"
ok "native surface verified for $ARCH_TAG"

# --------------------------------------------- assemble
DIST_ROOT="$ROOT/dist"
DEST="$DIST_ROOT/$NAME"
say "assembling"
rm -rf "$DIST_ROOT"
mkdir -p "$DEST"
cp -a "$TREE" "$DEST/dsh-termux"
cp "$ROOT/install-termux.sh" "$DEST/install.sh"
# Both languages, for both documents: the archive is read by whoever downloads it,
# and the deep analysis is the only place the evidence lives.
cp "$ASSETS/README.md" "$DEST/NOTES.md"
cp "$ASSETS/README.zh-CN.md" "$DEST/NOTES.zh-CN.md"
# The deep analysis is renamed on the way in (README -> NOTES), so its language
# switcher must be repointed at the renamed sibling rather than at the
# distribution README. Both patterns are unique in their source files.
sed -i 's|\[中文\](README\.zh-CN\.md)|[中文](NOTES.zh-CN.md)|' "$DEST/NOTES.md"
sed -i 's|\[English\](README\.md)|[English](NOTES.md)|' "$DEST/NOTES.zh-CN.md"
grep -q 'NOTES.zh-CN.md' "$DEST/NOTES.md" || die "NOTES.md language switcher was not repointed"
grep -q '](NOTES.md)' "$DEST/NOTES.zh-CN.md" || die "NOTES.zh-CN.md language switcher was not repointed"
for pair in "DIST-README.md:README.md" "DIST-README.zh-CN.md:README.zh-CN.md"; do
  src="${pair%%:*}"; out="${pair##*:}"
  [ -f "$ASSETS/$src" ] || die "$src is missing from $ASSETS"
  sed -e "s|{{NAME}}|$NAME|g" -e "s|{{VERSION}}|$VERSION|g" -e "s|{{UPSTREAM}}|$UPSTREAM|g" \
    "$ASSETS/$src" > "$DEST/$out"
done

# The archive redistributes a binary compiled from BSD-3-Clause source, whose
# condition 2 requires the notice to accompany the distribution. Refuse to build
# an archive without it rather than silently shipping a non-compliant one.
for f in LICENSE THIRD-PARTY-NOTICES.md; do
  [ -f "$ROOT/$f" ] || die "$f is missing from $ROOT; the archive would redistribute BSD-3-Clause code without its notice"
  cp "$ROOT/$f" "$DEST/$f"
done
ok "tree + install.sh + README(.zh-CN) + NOTES(.zh-CN) + LICENSE + THIRD-PARTY-NOTICES.md"

# --------------------------------------------- integrity data
say "recording per-file integrity"
( cd "$DEST" && find . -type f ! -name SHA256SUMS ! -name SYMLINKS.txt -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS )
( cd "$DEST" && find . -type l -printf '%p -> %l\n' | sort > SYMLINKS.txt )
FILES=$(wc -l < "$DEST/SHA256SUMS")
LINKS=$(wc -l < "$DEST/SYMLINKS.txt")
ABSOLUTE=$(grep -c ' -> /' "$DEST/SYMLINKS.txt" || true)
ok "$FILES files hashed, $LINKS symlinks recorded"
[ "$ABSOLUTE" -eq 0 ] || die "$ABSOLUTE absolute symlink(s) would break relocation"
ok "all symlinks are relative, so the tree relocates"

# --------------------------------------------- archive
say "creating the archive"
tar czf "$DIST_ROOT/$NAME.tar.gz" -C "$DIST_ROOT" "$NAME"
sha256sum "$DIST_ROOT/$NAME.tar.gz" > "$DIST_ROOT/$NAME.tar.gz.sha256"
SIZE=$(du -h "$DIST_ROOT/$NAME.tar.gz" | cut -f1)
UNPACKED=$(du -sh "$DEST" | cut -f1)
ok "$NAME.tar.gz  $SIZE (from $UNPACKED)"

say "done"
cat <<EOF
    archive : $DIST_ROOT/$NAME.tar.gz
    digest  : $(cut -d' ' -f1 "$DIST_ROOT/$NAME.tar.gz.sha256")
    staged  : $DEST

Copy the archive to a Termux device on Android/arm64, then:

    tar xzf $NAME.tar.gz
    cd $NAME
    sha256sum -c SHA256SUMS
    ./install.sh
EOF
