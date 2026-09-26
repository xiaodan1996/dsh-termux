# dsh-termux

A vendored **Termux (Android/arm64)** build of the DeepSeek Harness `dsh` CLI,
patched so it actually runs on Android — plus the tooling that produces it
reproducibly.

Upstream ships no Termux channel of its own, and `@deepseek-ai/dsh` **cannot boot
on Android as published**. This repository is a community channel for it, adapted
from an earlier one — see Credits below.

## Credits and provenance

**This project is adapted from
[`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)**
(MIT) — a community Termux port of the DeepSeek Harness CLI. The approach here comes
from that project, which also covers ground this repository does not.

Concretely derived from it:

| What | Where it appears here |
|---|---|
| the vendored-build shape: the `dsh-termux` package name and the `<upstream>-termux.N` version scheme | `termux/transform.js`, and the installed package name |
| `--expose-internals` as the way to reach Node's internals on Android | `termux/lib/termux-bin.js` (their `prebuilt/bin/dsh` does the same) |
| the `link(2)` → `rename` fallback for Android sepolicy | `termux/patch-hardlink.cjs` — the same fix as their `patches/02-session-persistence-link-rename.patch`, which also reached upstream 0.1.0-rc.7, where this repository recovered it from |

New here: support for upstream **0.1.7-rc.2** (that project targets the 0.1.0 line),
the `flock` addon compiled from source for the `node-addon-system` requirement that
0.1.5+ introduced, the bounded attachment durability walk, a committed lockfile with
`npm ci` for reproducible builds, the verification suite, and the self-contained
packaging script.

**Out of scope here, but handled there:** that project additionally patches the
terminal/bash and subprocess layers, the host directory picker,
`dsh-tool-fs-search` (ripgrep), `koffi` statx, and runs the sandbox through
**proot** — which gives real confinement on Android, where this build's sandbox
probe simply reports `unusable`. If you need those, use that project, or port its
patches forward.

No files from that project are redistributed here; the derivation is one of
approach. Its licence notice is reproduced in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Why patching is needed

Four Android realities break the CLI. Three arrived with 0.1.7; the fourth is
older than it and was found only by verifying the attachment path rather than
assuming it worked.

| # | Blocker | Symptom | Fix |
|---|---|---|---|
| 1 | `node-addon-require-builtin` has no android binding | `host preparation failed` — boot dies immediately | a launcher that re-execs Node with `--expose-internals` (the flag is rejected in `NODE_OPTIONS`) plus a vendored shim that serves Node internals through plain `require` |
| 2 | `flock` is platform-gated to linux/darwin | `flock is not supported on android-arm64` — **no session can be created** | bionic does provide `flock(2)`; the addon is compiled from upstream's public `native/system` source and vendored as the `android-arm64` platform package |
| 3 | `link(2)` is denied by sepolicy | `EACCES` publishing a session | fallbacks at all four publishing sites — and note 0.1.7 **dropped the workaround 0.1.0-rc.7 carried** |
| 4 | the attachment durability walk fsyncs up to `/` | `EACCES: permission denied, open '/data/data'` — attachments never saved | bound the walk by what the process can actually open; root-owned ancestors are already durable |

Each is documented in full — with the evidence that identified it, and what is
*not* covered — in [`termux/README.md`](termux/README.md).

## Requirements

- Termux on **Android/arm64 (aarch64)**. The artifact carries prebuilt native
  code and cannot cross architectures.
- Node.js >= 20 (`pkg install nodejs`), clang (`pkg install clang`) to build.
- ~1.5 GB free disk to build; ~330 MB installed.

## Build, install, package

```sh
./build-termux.sh 0.1.7-rc.2 1      # -> stage/dsh-termux ; installs from a pinned lockfile
./install-termux.sh stage/dsh-termux  # -> $PREFIX/lib/node_modules/dsh-termux

./package-termux.sh                 # -> dist/dsh-termux-<version>-android-arm64.tar.gz
```

`package-termux.sh` produces a self-contained archive: the target needs no npm,
no compiler and no network. It verifies the tree's *effective* native surface
(the files the runtime actually selects, not every `.node` file — npm packages
ship inert prebuilds for other platforms) and refuses to pack a non-aarch64 tree.

## Layout

| Path | What |
|---|---|
| `build-termux.sh` | fetch upstream, compile the flock addon, apply patches, `npm ci`, verify |
| `install-termux.sh` | deploy to `$PREFIX` by staged copy + two renames; keeps the previous install |
| `package-termux.sh` | assemble the archive for another device |
| `termux/` | the patches, the vendored shims, the launcher, and every verification script |
| `termux/README.md` | the full analysis: four blockers, verification matrix, known limitations |
| `VERIFICATION.md` | the last recorded verification run |

## Verification

The build runs its checks itself and fails loudly. Beyond boot, the suite covers
the paths a "it starts" smoke test would miss: a real kernel flock lease, the
hard-link fallbacks, sandbox degradation, the attachment publish chain, and a
**full agent loop against a mock LLM with no provider key**:

```sh
cd "$PREFIX/lib/node_modules/dsh-termux"
node verify/e2e-mock.mjs        # real headless agent, scripted model stream
```

Deployment is verified same-origin rather than assumed: a recursive `sha256`
manifest of every file and symlink target showed the deployed tree byte-identical
to the build output across all 25,861 entries.

## Reproducibility

`termux/package-lock.json` is committed and installs run with `npm ci`. Measured
on this tree:

| Build | Entries differing between two builds |
|---|---|
| `npm install`, unpinned | 44 |
| `npm ci` from the committed pin | **1** — and that one is this repository's own newly added verify script, not a dependency |

So all 25,843 dependency files reproduce byte-for-byte, and "rebuild and diff" is
a valid integrity check. The pin also cuts the install step from ~2–3 min to ~23 s.

## Known limitations

- **Kernel sandboxing is unavailable.** Android ships no Landlock LSM, so the
  sandbox probe reports `unusable` and only the DSH file policy applies. Helpers
  that would run confined run unconfined instead.
- **Sessions are rewritten forward on first open.** Opening a session written by
  0.1.0-rc.7 migrates it to format v4.
- The vendored flock addon is built for `android-arm64`; other architectures need
  their own build (the recipe is arch-parameterised, the binary is not).

## Licensing

This repository's own additions — the build, install and packaging scripts, the
Termux launcher and shims, the verification scripts, and the documentation — are
**MIT** licensed; see [`LICENSE`](LICENSE).

It is also a derivative work, and the pieces carry different terms. The notices
those licences require are reproduced in full in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md):

| Component | Licence | Where it lands |
|---|---|---|
| DeepSeek Harness `dsh` CLI | MIT (© 2026 DeepSeek) | fetched at build time; patched by `termux/patch-*.cjs`; not redistributed in this repository, but the patch files are derivative works |
| upstream `native/system` | BSD-3-Clause (© 2026 node-addon-landlock-run contributors) | `termux/native-src/flock.c` redistributed verbatim, and the `system.node` compiled from it |

The packaged archive under Releases reproduces both notices, and additionally
carries upstream's own `LICENSE` inside the tree.

### One upstream inconsistency worth knowing

`@deepseek-ai/node-addon-system` declares `BSD-3-Clause` in its `package.json` but
ships an **MIT** licence text (byte-identical to the CLI's). The source of truth in
the repository, `native/system/`, is genuinely BSD-3-Clause. Both texts are
reproduced in the notices so the requirement holds under either reading.
