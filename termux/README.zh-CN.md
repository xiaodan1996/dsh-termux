# `dsh` CLI 的 vendored Termux 构建

把上游 `@deepseek-ai/dsh` 发布物重建为 `dsh-termux` 包，并打上可在
Android/Termux 运行的补丁。

上游 CLI 包本身是**纯 JavaScript** —— `lib/*.js` 是预构建的 esbuild 产物 —— 所以
**启动器部分完全不需要编译移植**。在 Android 上出问题的，是少数几处上游伸手去够
Android 并不提供的宿主能力：一个预编译原生 addon、一个预编译 flock 绑定，以及 `link(2)`。

但**依赖树不是纯 JS**，这正是产物要打架构标签的原因：`node-pty` 在安装时会跑
`node scripts/prebuild.js || node-gyp rebuild`，在这里产出了新的 aarch64
`build/Release/pty.node`；而 `koffi` / `esbuild` 会解析到各自的 `android-arm64` 包。
因此随包发布的归档**内含预编译原生代码，无法跨架构** —— 见「分发」一节。

[English](README.md) | 中文

## 0. 出处

本构建改造自
[`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)
（MIT），社区维护的 DeepSeek Harness CLI Termux 移植。本次工作所起步的那份已安装的
`dsh-termux@0.1.0-rc.7-termux.1` 正是来自那个项目，其中三项技法被继承下来：
`dsh-termux` 这个包名与 `<上游版本>-termux.N` 版本方案、在 Android 上用
`--expose-internals` 触达 Node 内部模块、以及针对 sepolicy 的
`link(2)` → `rename` 回退。完整致谢、以及那个项目覆盖而本项目**没有**覆盖的范围，
见仓库 README 与 `THIRD-PARTY-NOTICES.md`。

> **由 AI 生成。** 本文档、以及它所描述的每一个脚本与补丁，都是在人类指挥下由运行于
> DeepSeek Harness 的 DeepSeek 模型写成的。这不是 DeepSeek 官方产品，方法也非 DeepSeek
> 原创 —— 见 §0。

## 1. 原始配方

通过把已安装的 `dsh-termux@0.1.0-rc.7-termux.1` 与上游
`@deepseek-ai/dsh@0.1.0-rc.7` 的 tarball 做 diff 反推得出。差异恰好是：

| 改动 | 原因 |
|---|---|
| `name` → `dsh-termux`，`version` → `<上游版本>-termux.N`，描述加后缀 | 为 vendored 构建改名 |
| `bin` 增加 `dsh-termux` 别名 | 区分这是 vendored 构建 |
| 把 `@img/sharp-wasm32` 加为**直接**依赖 | `@deepseek-ai/dsh-attachment-local` → `sharp`，而 `sharp` 没有 android/arm64 预编译。`sharp` 是在运行时从 `optionalDependencies` 里挑二进制，而那些条目的 `cpu` 门禁是 `wasm32`，所以 wasm 运行时**永远不会被传递依赖选中**，必须在顶层钉住。 |
| `bundleDependencies` = 全部依赖 | 让 `npm pack` 自包含 |

`build-termux.sh` 复现了这些，并在此之上加入下面这些修补。

## 2. 四处 Android 阻塞点（0.1.7 引入三处，另一处比它更早）

### 2.1 `node-addon-require-builtin` 没有 android 绑定

`@deepseek-ai/dsh-app-boot` 通过改写 Node 内部的 ESM 与 CommonJS 解析器，来安装它的
profile 模块解析拦截。它取得那些解析器的方式是预编译 addon
`node-addon-require-builtin`，而该 addon 只为 darwin、linux-gnu、win32 发布平台包。
在 Termux 上，这个模块**在 import 阶段就抛错**（它的 `createEntryApi` 在模块作用域执行）：

```
dsh: fatal uncaught exception: dsh: host preparation failed:
No usable native binding found for node-addon-require-builtin-android-arm64 (auto)
```

**修法。** Node 自带的 `--expose-internals` flag 能以普通 `require` 暴露同样的五个内部
模块，且 `internalModules()` 断言过的每个 API 都在
（`esm.getOrInitializeCascadedLoader()`、`cjs.Module._resolveFilename`、
`helpers.getCjsConditions`、`esm/utils.getDefaultConditions`、
`esm/resolve.defaultResolve`）。该 flag 被 `NODE_OPTIONS` 拒绝，因此只能在命令行上给：

- `lib/termux-bin.js` —— 新增的启动器；带着 `--expose-internals` 重新 exec
  `lib/bin.js`。`lib/bin.js` 必须是**主**模块：它用 `if (import.meta.main)` 守着自身
  主体，所以「import 它」会静默什么都不做。
- `vendor/node-addon-require-builtin/` —— 保持上游契约的垫片
  （`requireBuiltin`、`isAllowedInternalId`、`getBindingInfo`）。它**先尝试真正的原生路径**，
  因此在有绑定的宿主上是惰性的，只有失败时才回退到 `--expose-internals`。通过包的
  `dependencies` **和** `overrides` 接入：npm 拒绝 spec 与直接依赖不一致的 override，
  而这一个**正是**上游 dsh 的直接依赖。

CLI 自己的 `--version` 取自 `dsh-app-boot` 的 manifest，而非本包的，所以它始终报告上游
版本号。这是刻意的：同一个值会喂给插件 peer 兼容性检查，必须保持上游形式。

### 2.2 `flock` 在 android-arm64 上不受支持

`dsh-session-persistence-jsonl`（≥ 0.1.5）通过
`@deepseek-ai/node-addon-system/flock` 获取会话写租约：

```js
if (platform !== 'linux' && platform !== 'darwin') throw ERR_FLOCK_UNSUPPORTED_PLATFORM
```

`process.platform` 是 `android`，于是**每一次会话创建都死**：

```
dsh: flock is not supported on android-arm64
```

`SessionWriteLease.acquire` 只把 `EAGAIN`/`EWOULDBLOCK` 视为锁竞争，其余一律重新抛出，
所以这**阻塞了所有新会话**。

**修法。** Android 的 bionic libc 其实**实现了** `flock(2)`；缺的只是预编译打包，而该
addon 的上游源码是公开的（`native/system/packages/entry/src/flock.c`，约 160 行的
Node-API 绑定）。构建时用与上游相同的编译参数编译它，并作为本宿主会解析到的平台包
vendored 进来（`@deepseek-ai/node-addon-system-android-arm64`、`bin/musl/system.node`）。
随后 `patch-flock.cjs` 教会 `flock.js` 认识 `android` —— 两处精确改动，幂等，且在上游措辞
漂移时**拒绝打补丁**。

npm 上的 glibc/musl 预编译包先被验证过，**不可用**：glibc 报
`library "libc.so.6" not found`，musl 报缺 `__errno_location`。

### 2.3 `link(2)` 被拒，而 0.1.7 把上游自己的回退删掉了

在这台设备上，Termux 数据文件系统**直接拒绝硬链接**（`ln` → `EACCES`），而这正是打断
DSH 原子文件发布的原因：

```
dsh: EACCES: permission denied, link '.../session.v4.jsonl.zstd.<hex>.tmp'
     -> '.../session.v4.jsonl.zstd'
```

`dsh 0.1.0-rc.7` 曾带着一段明确的变通，连注释一起：

```js
/* Android sepolicy blocks link(2) (EACCES/EPERM); fall back to same-filesystem atomic rename */
```

0.1.7 的重写保留了 `link(2)`，**却把 `catch` 丢了**。这是上游在 Android 上的**回归**，
不是 Termux 构建引入的。

**修法。** `patch-hardlink.cjs` 在全部四个 `link(2)` 发布点补回回退，每一处都保住该点自身
的契约：

| 位置 | 回退方式 | 为何等价 |
|---|---|---|
| 会话落盘（materialize） | `rename` | 该处代码紧接着就会 unlink 暂存名，而这正是 `rename` 做的事 |
| 迁移 / 独占式代次发布 | `O_EXCL` 抢占 + 拷贝 | 该处 `link(2)` 的语义是「不存在才发布」；裸 `rename` 会覆盖，所以用 `open(…, "wx")` 保住独占性 |
| 附件别名发布 | `COPYFILE_EXCL` | 源必须保留，所以用拷贝；`EEXIST` 仍然意味着「已发布」 |
| 附件暂存发布 | `COPYFILE_EXCL` | 同上，且暂存文件紧接着被 unlink |

`dsh-fs-local` 也 import 了 `link`，但从未调用。

### 2.4 附件从来就存不下来（既存缺陷，非 0.1.7 回归）

`@deepseek-ai/dsh-attachment-local` 证明耐久性的方式是：把 `$DSH_HOME` 的**每一级祖先**
一路 fsync 到文件系统根：

```js
await ensureDurableDirectory(home, parse(home).root);   // boundary = "/"
```

Android 对 app 沙箱**拒绝 `/`、`/data`、`/data/data`** —— 它们归 system 所有、无读权限
—— 所以这个遍历**还没走到任何进程自己拥有的条目就死了**：

```
EACCES: permission denied, open '/data/data'
```

于是**每一次附件保存都失败**，图片和普通文件一视同仁。`dsh 0.1.0-rc.7` 里的
`ensureDurableHome` 与 `syncDirectory` 与本版**逐字节相同**，所以这**早于** 0.1.7，
**不是**它带来的回归：两版在 Termux 上附件都从未可用。

**修法。** `patch-durable-walk.cjs` 把这个遍历的边界限定为**进程实际打得开的最高祖先**。
该点以上归 root 所有、本身已是耐久的，也不归本进程去同步；而进程自己拥有的每一级**仍然
照旧逐级 fsync**。`ensureDurableHome` 是唯一把文件系统根当作边界传入的调用点，因此改动
被限制在它内部。与硬链接那条不同，这一条**没有上游先例** —— 上游假定文件系统根可达，
这在它发布的所有平台上都成立。

## 3. 验证

`build-termux.sh` 每次构建都会跑这些；它们也可从 `stage/dsh-termux/verify/` 重跑：

以上每一个数字都来自同一台机器：**从 F-Droid 安装的 Termux 0.118.3**
（`TERMUX_APK_RELEASE=F_DROID`、`TERMUX_MAIN_PACKAGE_FORMAT=debian`、
`TERMUX_IS_DEBUGGABLE_BUILD=0`）、Node **v24.18.0**、Android/arm64。
其他来源的 Termux **未做测试**，而 Play 版根本无法运行本构建。

| 检查 | 结果 |
|---|---|
| `dsh-termux --version` | 报告 `0.1.7-rc.2` |
| 全新 `DSH_HOME` 下的 profile 自动初始化 | `web` 与 `headless` profile 均能初始化并合成其配置树 |
| Web GUI 服务 | HTTP 200，34 KB shell，`__DSH_BOOT__` 就位 |
| 会话创建 + 持久化 | 写出 `session.v4.jsonl.zstd`，链接数为 1，无 `.tmp` 残留 |
| **无服务商密钥的完整 agent 回路** | `verify/e2e-mock.mjs` 驱动真实的 headless agent 对着 `@deepseek-ai/dsh-llm-mock-server` 跑；exit 0，mock 流被回显 |
| flock | `verify/flock-probe.mjs` 取到真实租约 |
| 硬链接回退 | `verify/fallback-primitives.mjs` —— 4/4，包括 `O_EXCL` 与 `COPYFILE_EXCL` 仍然拒绝已存在的目标 |
| 0.1.7 之前会话的迁移 | 已实测：v0 产物被前向迁移为 `session.v4.jsonl.zstd`，而它的 v0 代次仍留在磁盘上 |
| 沙箱降级 | `verify/verify-termux.mjs` —— 5/5：`probe()` 返回 `unusable`、`launcherPath()` 解析到不存在的二进制、`grantArgs()` 产出正确的 flag、`LocalSandboxProvider` 仍可构造 |
| 附件发布链路 | `verify/verify-termux.mjs` —— `saveFile` 走通**两个** `link(2)` 回退点、在 `EEXIST` 路径上去重、字节可回读，且落下的对象链接数为 1 |
| Termux 上的 sharp | 同一次运行：`saveImage` 归一化并存储了一张生成的 PNG，说明 `@img/sharp-wasm32` 确实接上了 |
| **对真实 `~/.dsh` 的附件** | `verify/live-attachment-check.mjs` —— 4/4：`saveImage` 与 `saveFile` 写入真实 store 并读回，且 store 树被**原样恢复**（根目录、文件、目录都算）。在 durable-walk 修复之前，正是这条检查会死在 `EACCES: open '/data/data'` |
| **通过 GUI 编辑器上传的附件** | `verify/attachment-e2e-verify.mjs` —— 真实上传 4/4：store 恰好新增一个内容寻址对象，其摘要等于其路径，且可解码为 `ffd8ff` JPEG；会话日志（解出 357 个 zstd 帧 / 1,616 个事件）在 `agent/inbox/spliced` 与 `user/message` 中带有结构化记录 `{attachmentId, mediaType: image/jpeg, width: 960, height: 960, bytes: 118795}` |

**没有任何一层是未验证的。** 「编辑器 → store → 会话日志」这条路径由一次真实上传覆盖。
而这个验证器**自己的前两版**值得一提，因为两者都错得很有教益：

- 用散文词 `attachment` 匹配 —— 在一段**只是在讨论**附件的对话记录上也能通过，哪怕
  根本没有任何附件；
- 用事件**类型名**匹配（`attach`/`image`/`upload`）—— 报 0，因为真正的信号是事件
  **载荷里的附件对象**，而不是承载它的那个事件的类型名。

两者都被替换为结构性判据：事件载荷里必须出现
`{"attachment":{"attachmentId":"sha256:<已存储摘要>",...}}`。**这个条件无法被「对话谈论
自己」所满足** —— 而前两版缺的正是这个性质。

现在每一处 `link(2)` 回退点都**真正跑过**，而不只是推理过：会话落盘与独占/迁移发布在
0.1.7 迁移一个 0.1.7 之前的会话时**实机跑过**；两个附件点既在 `verify/verify-termux.mjs`
里跑，也对着真实 `~/.dsh` 跑。这些检查最近一次是在**已部署的全局安装**上跑的，不只是
构建树上。

部署是**实测同源**而非假定：对每个文件与每个符号链接目标做递归 `sha256` 清单，显示部署树
与构建输出在全部 25,859 个条目上**逐字节相同**。

### 可复现性：由已提交的 lockfile 钉死

对同一个上游 tarball 跑两次独立的 `npm install`，产出的树**相差 44 个条目**（两边各约 21，
再加上本仓库自己改过的验证脚本）。受影响的包是 `@deepseek-ai/libreoffice-kit`、
`@types/node`、`@smithy/signature-v4` 与 `bundle-name`，且生成的 `package-lock.json`
两次之间也不同 —— 所以原因是**依赖版本漂移**，不是 npm 布局噪声。上游把自己的
`@deepseek-ai/*` 依赖钉得很死，但传递依赖树仍是在安装时按 range 解析的。

这让「重建再 diff」变成一种**无效**的完整性校验，也会让后续重建带上略为不同的传递依赖版本。

**这个问题现在已经修掉。** `termux/package-lock.json` 已提交，`build-termux.sh` 用
`npm ci` 从它安装，同时校验每一条已记录的完整性哈希。在本构建树上实测：

| 构建方式 | 两次构建之间的差异条目 |
|---|---|
| `npm install`（未钉死） | 44 |
| 从已提交 pin 走 `npm ci` | **1** —— 且那一条是本仓库自己的 `verify/live-attachment-check.mjs`，不是依赖 |

也就是说全部 25,843 个依赖文件**逐字节可复现**，把新构建与 `manifest-stage.txt` 对比
重新成为有效的完整性校验。这个 pin 顺带把安装步骤从约 2–3 分钟压到约 23 秒，因为它免去了
版本解析。

pin 记录了 `@deepseek-ai/*` 在上游发布时的确切版本，外加传递依赖树。重新生成它是**刻意
动作**：删掉 `termux/package-lock.json`，下次构建就会退回 `npm install` 并写出一个新 pin。

## 4. 分发

```sh
./package-termux.sh                      # -> dist/dsh-termux-<版本>-android-arm64.tar.gz
./package-termux.sh stage/dsh-termux android-arm64
```

归档是自包含的：目标设备不需要 npm、不需要编译器、不需要网络。它**不是**架构中立的，所以
架构标签写在文件名里，且脚本会在树的原生面不是 aarch64 时**拒绝打包**。

架构检查**刻意不去**扫描每一个 `.node` 文件。npm 包会带上其他平台的惰性预编译 ——
`node-pty` 就带着 darwin、win32 和 `linux-x64` 的构建，这里**12 个 `.node` 文件中有 7 个**
是 Android 永远不会解析到的。一条「所有二进制都必须是 aarch64」的粗暴规则会把 `linux-x64`
判为失败，那是**假阳性**：那文件是死重，不是可移植性 bug。脚本主张的其实是**运行时实际会
选中**的那一组：

| 由什么选中 | 文件 |
|---|---|
| `android-arm64` 平台包 | `@esbuild/android-arm64/bin/esbuild` |
| `android-arm64` 平台包 | `@koromix/koffi-android-arm64/android_arm64/koffi.node` |
| `android-arm64` 平台包 | `@deepseek-ai/node-addon-system-android-arm64/bin/musl/system.node` |
| vendored flock 包 | `vendor/node-addon-system-android-arm64/bin/musl/system.node` |
| node-pty 的平台回退 | `node-pty/build/Release/pty.node` |

这五个必须都存在且为 aarch64 ELF，否则打包中止。

可移植性是**实测**而非假定。为此修掉了两处：

- `verify/flock-probe.mjs` 与 `verify/fallback-primitives.mjs` 硬编码了构建工作区的绝对
  路径，因此它们**只在构建它的那台机器上**能通过。两者现在都用 `os.tmpdir()`。
- `verify/attachment-e2e-verify.mjs` 把基线写进构建工作区，**并且把用户解码后的会话日志
  转储成文件**。那个转储不服务于任何检查，是个隐私隐患；现已移除，基线也移到了
  `os.tmpdir()`。

这之后：**全部 16 个符号链接都是相对路径**，两个 lockfile 都把 `file:` 依赖记为相对的
`vendor/...` 路径，且**没有任何随包脚本引用构建工作区** —— 通过把包解压到构建目录**之外**
再检查来验证。

归档带有 `SHA256SUMS`（25,848 个文件），因此目标设备的第一步可以是
`sha256sum -c SHA256SUMS`。

## 5. 已知限制

- **沙箱能力退化为无。** Landlock 是 Linux LSM，Android 不带，也没有构建任何
  `landlock-run` 启动器。`launcherPath()` 解析到一个不存在的回退路径，探针报
  `unusable` —— 这正是上游对「内核不支持」的设计方式：文件策略仍然生效，内核强制层不生效。
  预期行为与上一版 Termux 构建一致（`workspace-write`）。
- **`dsh-termux` 没有发布到 npm**（`npm view dsh-termux` → 404）。没有可跟进的上游 Termux
  渠道；这棵树就是渠道。
- 丢掉 `--expose-internals` 这条启动路径会直接打断启动，所以请通过 `dsh` / `dsh-termux`
  这个 bin（`lib/termux-bin.js`）来调用，不要直接跑 `lib/bin.js`。
- `dsh-app-boot/worker/profile-resolution-bootstrap` 是给树外消费者用的扩展点，它以自己的
  `execArgv` 启动；已安装的树里没有任何东西用它，而若有东西用了，它也不会继承那个 flag。
- **durable-walk 补丁是一次真实的行为变更**，也是这里唯一没有上游先例的一条：它把耐久性
  证明收窄到进程实际能 fsync 的条目。去掉它，附件在 Termux 上就又会失效；树里没有别的
  东西依赖它。
- **任何补丁都需要重启才生效。** 运行中的 dsh 会保留它已经加载的模块，所以 GUI 必须重启
  才能看到改过的代码。

## 6. 构建、安装与回滚

```sh
./build-termux.sh 0.1.7-rc.2 1          # -> stage/dsh-termux
./install-termux.sh stage/dsh-termux    # -> $PREFIX/lib/node_modules/dsh-termux
```

### 为什么产物是一棵树，而不是 npm tarball

`npm pack` **无法**为这个包产出可用的产物，而配方里的 `bundleDependencies` 字段也救不了：
npm 只打包 `dependencies`、**从不打包 `devDependencies`**，而 profile bundle 实际会解析到的
那些包（`dsh-host-webserver`、`dsh-session-persistence`、`dsh-llm-deepseek`、
`dsh-sandbox-policy` 等）恰恰是 CLI 的 devDependencies。打出来的 tarball 缺约 34 个包，
会在第一次懒加载时以 `MODULE_NOT_FOUND` 死掉。这是**实测**过的，不是假定。

所以产物就是那棵构建出的树，而这也正是现有 Termux 安装在磁盘上的形态。
`install-termux.sh` 通过拷贝来部署它。

`install-termux.sh` 会把上一份安装**改名保留而非删除**，并打印回滚命令。它还会在
`:3080` 上有 dsh web 实例在应答时**拒绝运行**，除非给出 `--force` —— 因为在运行中的 dsh
底下换树，可能通过懒加载把它弄坏。两个 bin 名字都会重新指向 `lib/termux-bin.js` ——
上一份安装指向的是 `lib/bin.js`，而它在 Android 上根本无法启动。

`$DSH_HOME/profiles/node_modules` 是 0.1.0-rc.7 时代的符号链接农场；0.1.7 通过运行时拦截
解析 profile 包，既不创建也不读取它。指向被交换路径的链接仍然能解析，而 0.1.7 丢弃的那些
包只是悬空而已。

### 回退

```sh
rm -rf "$PREFIX/lib/node_modules/dsh-termux"
mv "$PREFIX/lib/node_modules/dsh-termux.bak-<时间戳>" "$PREFIX/lib/node_modules/dsh-termux"
```

或者用 `./build-termux.sh 0.1.0-rc.7 1` 重建旧版本。

**不要把新构建指向一个「会话很重要」的 `DSH_HOME`**，除非迁移路径已经验证过：打开一个
0.1.7 之前的会话，会把它**前向重写**为 v4 格式。
