# dsh-termux

[English](README.md) | 中文

**Termux（Android/arm64）** 版的 DeepSeek Harness `dsh` CLI —— 自带完整依赖树，
并打上了让它能在 Android 上真正跑起来的补丁；同时包含可复现地生产它的全部工具。

> **由 AI 生成。** 本仓库的每一个文件 —— 脚本、Termux 补丁、启动器与垫片、验证套件、
> 以及这些文字 —— 都是在人类指挥下，由运行于 DeepSeek Harness 的 **DeepSeek** 模型
> 写成的。这**不是 DeepSeek 官方产品**，移植方法也不源自 DeepSeek；两点都写在下方
> [本项目是怎么写出来的](#本项目是怎么写出来的) 一节里。

上游自己并没有 Termux 渠道，而 `@deepseek-ai/dsh` **按发布状态在 Android 上无法启动**。
本仓库是它的一个社区渠道，改造自更早的一个 —— 见下方致谢。

## 致谢与出处

**本项目改造自
[`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)**
（MIT）—— 一个社区维护的 DeepSeek Harness CLI Termux 移植。本项目的思路来自那个项目，
而它覆盖的范围也比本仓库更广。

具体承袭自它的部分：

| 承袭内容 | 在本仓库的落点 |
|---|---|
| vendored 构建的形态：包名 `dsh-termux` 与 `<上游版本>-termux.N` 的版本方案 | `termux/transform.js`，以及安装后的包名 |
| 用 `--expose-internals` 在 Android 上触达 Node 内部模块 | `termux/lib/termux-bin.js`（对方的 `prebuilt/bin/dsh` 用的是同一招） |
| 针对 Android sepolicy 的 `link(2)` → `rename` 回退 | `termux/patch-hardlink.cjs` —— 与对方 `patches/02-session-persistence-link-rename.patch` 是同一个修法；该修法也曾进入上游 0.1.0-rc.7，本仓库正是从那里把它复原出来的 |

**本仓库新增的部分**：对上游 **0.1.7-rc.2** 的支持（那个项目针对的是 0.1.0 线）、
为 0.1.5+ 新引入的 `node-addon-system` 依赖而从源码编译的 `flock` addon、
有界化的附件耐久性遍历、用于可复现构建的已提交 lockfile 与 `npm ci`、
验证套件，以及自包含的打包脚本。

**本仓库不覆盖、但对方已解决的部分**：那个项目额外打了终端/bash 与 subprocess 层、
宿主目录选择器、`dsh-tool-fs-search`（ripgrep）、`koffi` statx 的补丁，并用
**proot** 跑沙箱 —— 那在 Android 上能提供真正的隔离，而本构建的沙箱探针只会报
`unusable`。如果你需要那些能力，请使用那个项目，或把它的补丁前向移植过来。

本仓库**没有再分发对方的任何文件**，这是思路层面的派生。其许可声明照录于
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。

## 本项目是怎么写出来的

本仓库的代码与文档，由运行于 DeepSeek Harness（`dsh`）的 **DeepSeek** 模型生成。
产生它们的那次会话记录显示：前段使用 `deepseek-v4-flash`，此后为 `deepseek-flash`。
覆盖范围包括 `build-termux.sh`、`install-termux.sh`、`package-termux.sh`、`termux/`
下的全部文件、验证脚本，以及这些文档中的文字。

人类的参与是：方向、决策与验收。每个补丁都连同**识别出它的证据**一起提出，并在被要求
后才应用；许可选择、仓库设置、对改造来源项目的标注，以及每一次重启与验证，都是人类决策。

以下三点需要说清，**它不是什么**：

- **不是 DeepSeek 官方产品。** DeepSeek 既是本仓库所打补丁的上游 `dsh` CLI 的作者
  （MIT，© 2026 DeepSeek），也是写下这些工具的模型的提供方 —— 但这个 fork 与 DeepSeek
  **无隶属关系、未获背书**。它是一个社区构建。
- **不是移植方法的原创者。** Termux 移植技术来自
  [`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)，
  如上文所标注。这里生成的是**把它推进到 0.1.7-rc.2** 的工作。
- **不是「绝不出错」的声明。** `termux/README.md` 里的若干结论，其实是对**同一轮工作中
  更早的错误判断**的更正 —— 一次被文件名混淆的 `link(2)` 测试、一个用散文匹配因而
  在「只是在讨论附件」的对话记录上也会通过的验证判据、一个把惰性预编译误判为架构错误的
  检查。这些都**记录在案而非悄悄修掉**，因为正是这些错误，才是其余检查可信的理由。

`VERIFICATION.md` 与 `termux/README.md` 中的每一项断言，都是**跑代码得出的**。
凡**未经验证**的地方，也照实写明而非含糊带过 —— 见 `termux/README.md` 里的
"未覆盖" 说明。

## 为什么必须打补丁

有四个 Android 现实会打断这个 CLI。前三个随 0.1.7 出现；第四个比它更早，是靠**实际去验证
附件路径**而非假定它可用才发现的。

| # | 阻塞点 | 现象 | 修法 |
|---|---|---|---|
| 1 | `node-addon-require-builtin` 没有 android 绑定 | `host preparation failed` —— 启动即死 | 用一个启动器重新 exec Node 并带上 `--expose-internals`（该 flag 被 `NODE_OPTIONS` 拒绝），外加一个 vendored 垫片，用普通 `require` 提供 Node 内部模块 |
| 2 | `flock` 被平台门禁限制在 linux/darwin | `flock is not supported on android-arm64` —— **任何新会话都建不了** | bionic 其实提供 `flock(2)`；从上游公开的 `native/system` 源码编译该 addon，并作为 `android-arm64` 平台包 vendored 进来 |
| 3 | `link(2)` 被 sepolicy 拒绝 | 发布会话时 `EACCES` | 在全部四个发布点补回回退 —— 注意 0.1.7 **删掉了 0.1.0-rc.7 原本带着的那个变通** |
| 4 | 附件耐久性遍历会一路 fsync 到 `/` | `EACCES: permission denied, open '/data/data'` —— 附件永远存不下来 | 把遍历边界限定为**进程实际打得开的最高祖先**；root 所有的祖先本来就已是耐久的 |

每一条的完整记录 —— 包括识别它的证据、以及**哪些没被覆盖** —— 都在
[`termux/README.md`](termux/README.md)。

## 环境要求

- **Termux 请用 F-Droid 版**，不是 Google Play 版。本构建是在 Termux 0.118.3 的
  F-Droid 安装上构建并验证的，该安装自身报告 `TERMUX_APK_RELEASE=F_DROID`。Play 版早已
  停止维护，**无法承载本构建**：它的年代早于本构建所需的 Node.js。另外，不同来源的 Termux
  构建**使用不同的签名密钥，无法互相覆盖安装**，因此更换来源意味着卸载并丢失 `$PREFIX`
  下的全部数据。
- Termux，且为 **Android/arm64（aarch64）**。产物内含预编译原生代码，无法跨架构。
- Node.js >= 20（`pkg install nodejs`）；构建需要 clang（`pkg install clang`）。
- 构建约需 1.5 GB 空闲磁盘；安装后约 330 MB。

## 构建、安装、打包

```sh
./build-termux.sh 0.1.7-rc.2 1        # -> stage/dsh-termux ；从钉死的 lockfile 安装
./install-termux.sh stage/dsh-termux  # -> $PREFIX/lib/node_modules/dsh-termux

./package-termux.sh                   # -> dist/dsh-termux-<版本>-android-arm64.tar.gz
```

`package-termux.sh` 产出的是**自包含**归档：目标设备不需要 npm、不需要编译器、不需要网络。
它会校验构建树**实际会被选中的**原生文件（而不是扫每一个 `.node` —— npm 包会带上其他平台
的惰性预编译），并在树不是 aarch64 时**拒绝打包**。

## 目录结构

| 路径 | 内容 |
|---|---|
| `build-termux.sh` | 拉取上游、编译 flock addon、打补丁、`npm ci`、验证 |
| `install-termux.sh` | 通过「暂存拷贝 + 两次 rename」部署到 `$PREFIX`；并保留上一份安装 |
| `package-termux.sh` | 组装给另一台设备用的归档 |
| `termux/` | 补丁、vendored 垫片、启动器，以及全部验证脚本 |
| `termux/README.md` | 完整分析：四处阻塞点、验证矩阵、已知限制 |
| `VERIFICATION.md` | 最近一次验证记录 |

## 验证

构建会自己跑检查，且**失败即大声报错**。除了能启动之外，这套检查覆盖了「能起来」这种冒烟
测试会漏掉的路径：真实的内核 flock 租约、硬链接回退、沙箱降级、附件发布链路，以及
**在无任何服务商密钥的前提下、对着 mock LLM 跑通完整 agent 回路**：

```sh
cd "$PREFIX/lib/node_modules/dsh-termux"
node verify/e2e-mock.mjs        # 真实 headless agent + 脚本化的模型流
```

部署是**实测同源**而非假定：对每个文件与符号链接目标做递归 `sha256` 清单，显示部署树与
构建输出在全部 25,861 个条目上**逐字节相同**。

以上每一个数字都来自同一台机器：**从 F-Droid 安装的 Termux 0.118.3**
（`TERMUX_APK_RELEASE=F_DROID`、`TERMUX_MAIN_PACKAGE_FORMAT=debian`、
`TERMUX_IS_DEBUGGABLE_BUILD=0`）、Node **v24.18.0**、Android/arm64。
其他来源的 Termux **未做测试**，而 Play 版根本无法运行本构建。

## 可复现性

`termux/package-lock.json` 已提交，安装一律走 `npm ci`。在本构建树上实测：

| 构建方式 | 两次构建之间的差异条目 |
|---|---|
| `npm install`（未钉死） | 44 |
| 从已提交 pin 走 `npm ci` | **1** —— 且那一条是本仓库自己新加的验证脚本，不是依赖 |

也就是说全部 25,843 个依赖文件**逐字节可复现**，「重建再 diff」重新成为有效的完整性校验。
这个 pin 顺带把安装步骤从约 2–3 分钟压到约 23 秒。

## 已知限制

- **内核级沙箱不可用。** Android 不带 Landlock LSM，因此沙箱探针报 `unusable`，只有 DSH
  自身的文件策略生效。本该在受限环境中运行的辅助程序，会以不受限方式运行。
- **会话在首次打开时会被前向重写。** 打开 0.1.0-rc.7 写下的会话，会把它迁移到 v4 格式。
- vendored 的 flock addon 是为 `android-arm64` 构建的；其他架构需要自行构建
  （配方是架构参数化的，二进制不是）。

## 许可

本仓库自身的产物 —— 构建、安装与打包脚本、Termux 启动器与垫片、验证脚本，以及文档 ——
采用 **MIT** 许可，见 [`LICENSE`](LICENSE)。

它同时是衍生作品，各部分条款不同。这些许可所要求的声明已**全文照录**于
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)：

| 组件 | 许可 | 落点 |
|---|---|---|
| DeepSeek Harness `dsh` CLI | MIT（© 2026 DeepSeek） | 构建时拉取；由 `termux/patch-*.cjs` 打补丁；本仓库不再分发它，但补丁文件是其衍生作品 |
| 上游 `native/system` | BSD-3-Clause（© 2026 node-addon-landlock-run contributors） | `termux/native-src/flock.c` 逐字再分发，以及由它编译出的 `system.node` |

Releases 下的分发包会同时带上这两份声明，并额外在树内携带上游自己的 `LICENSE`。

### 一处值得知道的上游不一致

`@deepseek-ai/node-addon-system` 在 `package.json` 里声明 `BSD-3-Clause`，随包附带的却是
一份 **MIT** 文本（与 CLI 的那份逐字节相同）。而仓库里的权威来源 `native/system/`
确实是 BSD-3-Clause。声明文件里把**两套文本都照录**，这样在任一种解读下要求都成立。
