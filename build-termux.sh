#!/data/data/com.termux/files/usr/bin/bash
#
# Build a vendored Termux build of the dsh CLI from an upstream
# @deepseek-ai/dsh release.
#
#   ./build-termux.sh [UPSTREAM_VERSION] [TERMUX_REV]
#   ./build-termux.sh 0.1.7-rc.2 1
#
# Outputs
#   stage/dsh-termux                 the built tree (runnable in place)
#   out/dsh-termux-<ver>-termux.<r>.tgz
#   stage/dsh-termux/verify/         re-runnable checks
#
# Why this is not just "npm install": the upstream package is pure JS and needs
# no compilation, but three Android realities break it, and each is repaired
# here. See termux/README.md for the full analysis.
#
set -euo pipefail

UPSTREAM="${1:-0.1.7-rc.2}"
REV="${2:-1}"
PKG_NAME="dsh-termux"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$ROOT/termux"
REF="$ROOT/ref"
STAGE="$ROOT/stage"
OUT="$ROOT/out"
DEST="$STAGE/$PKG_NAME"
NODE_HEADERS="$(dirname "$(command -v node)")/../include/node"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

for tool in node npm clang; do
  command -v "$tool" >/dev/null || die "$tool is required (pkg install nodejs clang)"
done
[ -d "$NODE_HEADERS" ] || die "Node headers not found at $NODE_HEADERS (node_api.h is required to build the flock addon)"

say "building $PKG_NAME $UPSTREAM-termux.$REV"
printf '    node    : %s\n' "$(node -v)"
printf '    clang   : %s\n' "$(clang --version | head -1)"
printf '    headers : %s\n' "$NODE_HEADERS"

# ---------------------------------------------------------------- 1. upstream
mkdir -p "$REF" "$STAGE" "$OUT"
TGZ="$REF/deepseek-ai-dsh-$UPSTREAM.tgz"
if [ -f "$TGZ" ]; then
  ok "reusing cached $(basename "$TGZ")"
else
  say "fetching @deepseek-ai/dsh@$UPSTREAM"
  ( cd "$REF" && npm pack "@deepseek-ai/dsh@$UPSTREAM" )
fi
[ -f "$TGZ" ] || die "tarball missing: $TGZ"

say "extracting upstream tree"
rm -rf "$DEST"; mkdir -p "$DEST"
tar xzf "$TGZ" -C "$DEST" --strip-components=1
[ -f "$DEST/lib/bin.js" ] || die "unexpected upstream layout: lib/bin.js missing"
ok "lib/ and package.json in place"

# ------------------------------------- 2. compile the Android flock addon
# dsh-session-persistence-jsonl (>= 0.1.5) takes its session write lease through
# @deepseek-ai/node-addon-system/flock, which ships only darwin/linux-gnu/win32.
# Android's bionic does provide flock(2), so the addon itself builds fine; only
# the prebuilt packaging is missing. Source: upstream native/system, public.
say "compiling the flock Node-API addon for $PKG_NAME on android-arm64"
mkdir -p "$DEST/vendor/node-addon-system-android-arm64/bin/musl"
clang -std=c11 -O2 -Wall -Wextra -fPIC -fvisibility=hidden \
  -DNAPI_VERSION=8 -I "$NODE_HEADERS" -shared \
  -o "$DEST/vendor/node-addon-system-android-arm64/bin/musl/system.node" \
  "$ASSETS/native-src/flock.c"
ok "system.node $(wc -c < "$DEST/vendor/node-addon-system-android-arm64/bin/musl/system.node") bytes"

# ------------------------------------------------- 3. lay down Termux assets
say "installing Termux patch assets into the stage"
mkdir -p "$DEST/lib" "$DEST/vendor"
cp "$ASSETS/lib/termux-bin.js" "$DEST/lib/termux-bin.js"
chmod +x "$DEST/lib/termux-bin.js"
cp -r "$ASSETS/vendor/node-addon-require-builtin" "$DEST/vendor/"
cp "$ASSETS/vendor/node-addon-system-android-arm64/package.json" "$DEST/vendor/node-addon-system-android-arm64/package.json"
ok "launcher + node-addon-require-builtin shim + platform package"

# ------------------------------------------------------- 4. rewrite manifest
say "rewriting package.json for Termux"
node "$ASSETS/transform.js" "$DEST" "$UPSTREAM" "$REV"

# ------------------------------------------------------------- 5. install
# devDeps are required: in 0.1.x the packages a profile bundle resolves to
# (dsh-host-webserver, dsh-sandbox-policy, dsh-attachment-local, ...) are
# devDependencies of the CLI, so --omit=dev yields a tree that cannot boot.
#
# A committed lockfile pins the transitive tree. Without it two identical builds
# resolved different transitive versions (~44 entries differed, and the generated
# lockfile hashes differed too), so "rebuild and diff" was not a valid integrity
# check. With it, `npm ci` installs exactly the recorded versions and verifies
# their integrity hashes.
LOCKFILE="$ASSETS/package-lock.json"
if [ -f "$LOCKFILE" ]; then
  say "installing dependency tree from the pinned lockfile (npm ci)"
  printf '    pin          : %s  (%s)\n' "$(sha256sum "$LOCKFILE" | cut -c1-16)" "$(basename "$LOCKFILE")"
  cp "$LOCKFILE" "$DEST/package-lock.json"
  ( cd "$DEST" && npm ci --include=dev --no-audit --no-fund --loglevel=warn )
else
  say "no lockfile pin yet: npm install, then capturing one"
  ( cd "$DEST" && npm install --include=dev --no-audit --no-fund --loglevel=warn )
  cp "$DEST/package-lock.json" "$LOCKFILE"
  ok "pinned $LOCKFILE ($(sha256sum "$LOCKFILE" | cut -c1-16)); commit it and rebuilds become fixed"
fi

# ------------------------------------------------------- 6. post-install patches
say "applying post-install patches"
cp "$ASSETS/patch-flock.cjs" "$ASSETS/patch-hardlink.cjs" "$ASSETS/patch-durable-walk.cjs" "$DEST/"
( cd "$DEST" && node patch-flock.cjs && node patch-hardlink.cjs && node patch-durable-walk.cjs )

# ------------------------------------------------------------- 7. verify
say "verifying the build"
[ -e "$DEST/node_modules/@img/sharp-wasm32" ] || die "@img/sharp-wasm32 missing: sharp has no fallback on Termux"
ok "@img/sharp-wasm32 present (sharp has no android/arm64 prebuild)"
[ -e "$DEST/node_modules/@deepseek-ai/dsh-base" ] || die "@deepseek-ai/dsh-base missing: profile bundles cannot resolve"
ok "profile bundles resolvable"
[ -e "$DEST/node_modules/@deepseek-ai/node-addon-system-android-arm64/bin/musl/system.node" ] \
  || die "flock addon not linked into node_modules"
ok "flock addon wired to node_modules"

VERSION="$(node "$DEST/lib/termux-bin.js" --version)"
printf '    %s reports %s\n' "$PKG_NAME" "$VERSION"

mkdir -p "$DEST/verify"
cp "$ASSETS/verify/"*.mjs "$DEST/verify/"
( cd "$DEST" && node verify/flock-probe.mjs )    || die "flock probe failed"
( cd "$DEST" && node verify/fallback-primitives.mjs ) || die "hard-link fallback primitives failed"
ok "flock and hard-link fallbacks behave on this filesystem"
( cd "$DEST" && node verify/verify-termux.mjs ) || die "sandbox/attachment verification failed"
ok "sandbox degrades cleanly and the attachment chain publishes"
( cd "$DEST" && node verify/e2e-mock.mjs ) || die "keyless agent loop failed"
ok "keyless agent loop passes against the mock LLM"

# ------------------------------------------------------- 8. artifact
# No npm tarball: npm bundles `dependencies` only, never `devDependencies`, and
# this package's runtime stack lives in devDependencies -- a packed tarball is
# missing ~34 packages and cannot boot. The built tree is the artifact, which is
# also the shape the existing Termux install already has on disk.
say "artifact"
du -sh "$DEST/node_modules" | awk '{print "    node_modules : " $1}'
printf '    tree size    : %s\n' "$(du -sh "$DEST" | cut -f1)"
printf '    packages     : %s @deepseek-ai, %s top-level\n' \
  "$(ls "$DEST/node_modules/@deepseek-ai" | wc -l)" "$(ls "$DEST/node_modules" | wc -l)"
[ -f "$ASSETS/package-lock.json" ] && printf '    pinned by    : %s\n' "$(sha256sum "$ASSETS/package-lock.json" | cut -c1-16)"

say "done"
cat <<EOF
    tree    : $DEST

Run it in place. With no DSH_HOME it uses your real ~/.dsh, so export a
scratch one first if you do not want this build touching your sessions:

    DSH_HOME=\$HOME/dsh-termux-build/home-test \\
      node $DEST/lib/termux-bin.js web --port 3099 --no-open

Full agent loop with no provider key (uses and removes its own scratch home):

    node $DEST/verify/e2e-mock.mjs

Install it globally (REPLACES the current dsh; see termux/README.md):

    ./install-termux.sh $DEST
EOF
