# {{NAME}}

A vendored Termux build of the DeepSeek Harness `dsh` CLI (upstream
`{{UPSTREAM}}`, packaged as `{{VERSION}}`), patched to run on Android.
Self-contained: **no npm, no compiler, and no network access are needed on the
target device.**

## Credits

Adapted from [`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)
(MIT), the community Termux port of this CLI. See `THIRD-PARTY-NOTICES.md` and
`NOTES.md`.

## Requirements

- Termux on **Android/arm64 (aarch64)** — this build is architecture-specific.
  It carries native binaries built or selected for `android-arm64`: the flock
  addon (`vendor/node-addon-system-android-arm64/bin/musl/system.node`, compiled
  from upstream's public `native/system` source), `node-pty`'s addon, `koffi`,
  and the `@esbuild/android-arm64` binary. It will not work on x86_64, i686 or
  armv7.
- Node.js >= 20 in Termux (`pkg install nodejs`). Built and verified on v24.18.0.
- Nothing else running `dsh web` on port 3080 (the installer refuses otherwise).

Check first:

```sh
uname -m          # must print aarch64
node -v           # must be >= v20
```

## Install

```sh
tar xzf {{NAME}}.tar.gz
cd {{NAME}}

# optional but recommended: verify every file against the recorded hashes
sha256sum -c SHA256SUMS

./install.sh
```

`install.sh` copies the tree to `$PREFIX/lib/node_modules/dsh-termux`, points
`$PREFIX/bin/dsh` and `$PREFIX/bin/dsh-termux` at `lib/termux-bin.js`, and renames
any previous install aside rather than deleting it. Use `--prefix DIR` to install
elsewhere (handy for a dry run), or `--force` to proceed while a dsh web instance
is running. The swap is two renames, so a running dsh never sees a half-written
tree.

Then:

```sh
dsh --version     # {{UPSTREAM}}
dsh web           # open the URL it prints, including the ?token=...
```

## Verify this build yourself

The shipped tree carries its own checks and needs **no provider API key**:

```sh
cd "$PREFIX/lib/node_modules/dsh-termux"
node verify/flock-probe.mjs              # real kernel flock lease
node verify/fallback-primitives.mjs      # hard-link fallbacks behave
node verify/verify-termux.mjs            # sandbox degradation + attachment chain
node verify/e2e-mock.mjs                 # full agent loop against a mock LLM
```

Two further checks touch live state on purpose: `verify/live-attachment-check.mjs`
exercises the attachment store against the real `~/.dsh` (it restores it
afterwards), and `verify/attachment-e2e-verify.mjs` checks one image uploaded
through the GUI — record a baseline with `--baseline` *before* uploading, then
re-run it after.

## Uninstall / roll back

```sh
# roll back to whatever was installed before (if anything was)
rm -rf "$PREFIX/lib/node_modules/dsh-termux"
mv "$PREFIX/lib/node_modules/dsh-termux.bak-"* "$PREFIX/lib/node_modules/dsh-termux"

# or remove entirely
rm -rf "$PREFIX/lib/node_modules/dsh-termux" "$PREFIX/bin/dsh" "$PREFIX/bin/dsh-termux"
```

## What is inside

| Path | What it is |
|---|---|
| `dsh-termux/` | the built package: `lib/` (the CLI), `vendor/` (Termux shims), `node_modules/` |
| `dsh-termux/verify/` | the checks listed above |
| `dsh-termux/transform.js`, `patch-*.cjs` | build-time provenance, kept so the four Android patches stay auditable |
| `dsh-termux/package-lock.json` | the pinned dependency tree this build installed from |
| `install.sh` | the installer |
| `LICENSE` | MIT, covering this repository's own additions |
| `THIRD-PARTY-NOTICES.md` | the upstream MIT and BSD-3-Clause notices this archive redistributes under |
| `SHA256SUMS`, `SYMLINKS.txt` | per-file integrity data (all symlinks are relative) |
| `NOTES.md` | the full analysis: the four Android blockers, what was patched and why |

## Known limitations

Read `NOTES.md` for the evidence behind each of these.

- **Kernel sandboxing is unavailable.** Android ships no Landlock LSM, so the
  sandbox probe reports `unusable` and only the DSH file policy applies; there is
  no kernel-enforced confinement, and helpers that would run confined run
  unconfined instead.
- **Sessions are rewritten forward on first open.** Opening a session written by
  0.1.0-rc.7 migrates it to format v4. The previous generation is left on disk,
  but back up `$DSH_HOME/sessions` first if you may need to go back.
- **`dsh-termux` is not published to npm.** This archive is the distribution
  channel; there is nothing to update from.
- Launch through the `dsh` binary. Running `lib/bin.js` directly skips
  `lib/termux-bin.js`, which is what adds the `--expose-internals` flag that boot
  requires on Android.
