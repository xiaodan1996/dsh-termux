#!/data/data/com.termux/files/usr/bin/bash
#
# Install a tree built by build-termux.sh as the global dsh on this device.
#
#   ./install-termux.sh [--prefix DIR] [--force] [TREE]
#
# The built tree is deployed by copying, not by `npm install -g`: npm bundles
# only `dependencies` and never `devDependencies`, and this package's runtime
# stack lives in devDependencies, so a packed tarball cannot boot. Copying the
# whole tree is also exactly the shape the existing Termux install already has.
#
# The previous install is renamed aside, never deleted, and the rollback command
# is printed at the end.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"
TREE=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX_DIR="$2"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) TREE="$1"; shift ;;
  esac
done
# Default tree: the build workspace layout, or a sibling directory when this
# script is shipped inside an extracted distribution archive.
if [ -z "$TREE" ]; then
  if [ -d "$ROOT/stage/dsh-termux" ]; then TREE="$ROOT/stage/dsh-termux"
  elif [ -d "$ROOT/dsh-termux" ]; then TREE="$ROOT/dsh-termux"
  else die "no tree given and neither $ROOT/stage/dsh-termux nor $ROOT/dsh-termux exists; pass the built tree as an argument"
  fi
fi
TREE="$(cd "$TREE" && pwd)"

PKG="dsh-termux"
DEST="$PREFIX_DIR/lib/node_modules/$PKG"
BINDIR="$PREFIX_DIR/bin"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------- validate src
say "validating $TREE"
[ -f "$TREE/package.json" ] || die "no package.json in $TREE"
NAME="$(node -p "require('$TREE/package.json').name")"
VERSION="$(node -p "require('$TREE/package.json').version")"
[ "$NAME" = "$PKG" ] || die "expected package name $PKG, found $NAME"
[ -f "$TREE/lib/termux-bin.js" ] || die "lib/termux-bin.js missing: this tree was not built for Termux"
[ -d "$TREE/node_modules/@deepseek-ai/dsh-base" ] || die "node_modules incomplete (dsh-base missing)"
[ -f "$TREE/node_modules/@deepseek-ai/node-addon-system-android-arm64/bin/musl/system.node" ] \
  || die "flock addon missing: sessions would fail on this host"
ok "$NAME $VERSION, tree complete"

# ------------------------------------------------------------- live warning
if curl -s -o /dev/null -m 2 "http://127.0.0.1:3080/" 2>/dev/null; then
  warn "a dsh web instance is answering on :3080"
  if [ "$FORCE" -ne 1 ]; then
    die "replacing the install under a running dsh can break it mid-session; stop it first, or pass --force"
  fi
  warn "--force given; continuing with a live dsh web instance"
fi

# ------------------------------------------------------------- swap
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DEST.bak-$STAMP"
HAS_BACKUP=0
say "installing into $DEST"
mkdir -p "$(dirname "$DEST")" "$BINDIR"
# Copy into a sibling staging directory first, then swap with two renames. The
# window in which $DEST does not exist shrinks from the whole copy (minutes) to
# two rename syscalls, which matters because a running dsh resolves lazy imports
# by path and must not observe a half-written tree.
STAGING="$(dirname "$DEST")/.$PKG.new-$STAMP"
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -a "$TREE/." "$STAGING/"
ok "tree staged at $STAGING ($(du -sh "$STAGING" | cut -f1))"

if [ -e "$DEST" ]; then
  mv "$DEST" "$BACKUP"
  HAS_BACKUP=1
  ok "previous install kept at $BACKUP"
else
  warn "no previous install to back up"
fi
mv "$STAGING" "$DEST"
ok "swapped into place"

# ------------------------------------------------------------- relink bins
# Both names must point at the launcher, not lib/bin.js: the launcher is what
# adds --expose-internals, without which boot dies on Android.
for name in dsh dsh-termux; do
  rm -f "$BINDIR/$name"
  ln -s "../lib/node_modules/$PKG/lib/termux-bin.js" "$BINDIR/$name"
done
ok "$BINDIR/dsh -> ../lib/node_modules/$PKG/lib/termux-bin.js"

# ------------------------------------------------------------- verify
say "verifying the installed build"
VERSION_OUT="$(node "$DEST/lib/termux-bin.js" --version)"
printf '    %s --version -> %s\n' "$PKG" "$VERSION_OUT"
[ -n "$VERSION_OUT" ] || die "the installed build does not start; roll back with: mv '$BACKUP' '$DEST'"

say "done"
cat <<EOF
    installed : $DEST
    launcher  : $BINDIR/dsh  ($VERSION_OUT)
    backup    : $([ "$HAS_BACKUP" -eq 1 ] && echo "$BACKUP" || echo "(none: no previous install)")

Roll back with:

    rm -rf "$DEST" && mv "$BACKUP" "$DEST"

Notes
  - \$DSH_HOME/profiles/node_modules is a symlink farm created by the 0.1.0-rc.7
    era; 0.1.7 resolves profile packages by runtime interception instead and does
    not create or read it. Links into the swapped paths still resolve, and the
    few packages 0.1.7 dropped will dangle harmlessly. Remove it only if you see
    resolution errors.
  - Opening a pre-0.1.7 session rewrites it forward to format v4. Back up
    \$DSH_HOME/sessions first if you may need to go back.
EOF
