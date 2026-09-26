# Third-party notices

This repository derives from and redistributes third-party work. The notices
those licenses require follow. The repository's own additions — the build,
install and packaging scripts, the Termux launcher and shims, the verification
scripts, and the documentation — are under the MIT license in
[`LICENSE`](LICENSE).

---

## 1. DeepSeek Harness `dsh` CLI — MIT

**Applies to:** the upstream CLI that `build-termux.sh` downloads and patches, and
to the `termux/patch-*.cjs` and `termux/transform.js` patches that modify it.

The CLI itself is **not redistributed in this repository** — it is fetched from
npm at build time — but the patches are derivative works of it, and the packaged
archive published in Releases contains the CLI together with this notice (and
upstream ships its own `LICENSE` inside the tree, which the archive preserves).

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. `@deepseek-ai/node-addon-system` / upstream `native/system` — BSD-3-Clause

**Applies to:** `termux/native-src/flock.c`, redistributed verbatim, and
`termux/vendor/node-addon-system-android-arm64/bin/musl/system.node`, which is
compiled from that source. The packaged archive additionally contains the same
source as shipped inside the npm package.

```
BSD 3-Clause License

Copyright (c) 2026, node-addon-landlock-run contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 2a. Note on an upstream licence inconsistency

Upstream states two different licences for this one component, so both texts are
reproduced here and the notice holds under either reading:

| Source | Declared in `package.json` | Licence text shipped |
|---|---|---|
| npm package `@deepseek-ai/node-addon-system` | `BSD-3-Clause` | MIT, © 2026 DeepSeek |
| repository `native/system/` | `BSD-3-Clause` | BSD-3-Clause, © 2026 node-addon-landlock-run contributors |

`termux/native-src/flock.c` was taken from the repository path (the table's second
row), so the BSD-3-Clause text in section 2 governs it. The npm package's own
LICENSE text is reproduced below because that is the text shipped alongside the
same source in the packaged archive, and it is byte-identical to the CLI's MIT
licence above.

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. `Vengisk/deepseek-harness-termux` — MIT

**Applies to:** the approach this repository is adapted from. No files from that
project are redistributed here, so this is attribution of derivation rather than of
copied material — but the derivation is substantive and is credited in the
repository README:

- the vendored-build shape, i.e. the `dsh-termux` package name and the
  `<upstream>-termux.N` version scheme;
- `--expose-internals` as the way to reach Node's internals on Android;
- the `link(2)` → `rename` fallback for Android sepolicy
  (their `patches/02-session-persistence-link-rename.patch`).

Its `LICENSE` carries the MIT text below, attributed to the same copyright holder as
upstream. It is byte-identical to the text in section 1 apart from a trailing
newline.

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Project: https://github.com/Vengisk/deepseek-harness-termux
