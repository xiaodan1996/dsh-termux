# {{NAME}}

[English](README.md) | 中文

Termux（Android/arm64）版的 DeepSeek Harness `dsh` CLI（上游 `{{UPSTREAM}}`，
打包为 `{{VERSION}}`），已打上可在 Android 运行的补丁。
**自包含**：目标设备**不需要 npm、不需要编译器、不需要网络**。

## 致谢

改造自 [`Vengisk/deepseek-harness-termux`](https://github.com/Vengisk/deepseek-harness-termux)
（MIT），社区维护的该 CLI Termux 移植。另见 `THIRD-PARTY-NOTICES.md` 与 `NOTES.zh-CN.md`。

**由 AI 生成：** 本归档中的构建工具与补丁，是在人类指挥下由运行于 DeepSeek Harness 的
DeepSeek 模型写成的。这不是 DeepSeek 官方产品，移植方法源自上述那个项目。

## 环境要求

- **Termux 请用 F-Droid 版**，不是 Google Play 版。本构建是在 Termux 0.118.3 的
  F-Droid 安装上构建并验证的，该安装自身报告 `TERMUX_APK_RELEASE=F_DROID`。Play 版早已
  停止维护，**无法承载本构建**：它的年代早于本构建所需的 Node.js。另外，不同来源的 Termux
  构建**使用不同的签名密钥，无法互相覆盖安装**，因此更换来源意味着卸载并丢失 `$PREFIX`
  下的全部数据。
- Termux，且为 **Android/arm64（aarch64）** —— 本构建与架构绑定。
  它内含为 `android-arm64` 构建或挑选的原生二进制：flock addon
  （`vendor/node-addon-system-android-arm64/bin/musl/system.node`，由上游公开的
  `native/system` 源码编译而来）、`node-pty` 的 addon、`koffi`，以及
  `@esbuild/android-arm64` 的二进制。它在 x86_64、i686 或 armv7 上**无法工作**。
- Termux 中的 Node.js >= 20（`pkg install nodejs`）。构建与验证基于 v24.18.0。
- 确保没有别的进程正在监听 3080 端口跑 `dsh web`（否则安装脚本会拒绝执行）。

先确认一下：

```sh
uname -m          # 必须输出 aarch64
node -v           # 必须 >= v20
```

## 安装

```sh
tar xzf {{NAME}}.tar.gz
cd {{NAME}}

# 可选但建议：对照已记录的哈希逐文件校验
sha256sum -c SHA256SUMS

./install.sh
```

`install.sh` 会把整棵树拷到 `$PREFIX/lib/node_modules/dsh-termux`，把
`$PREFIX/bin/dsh` 与 `$PREFIX/bin/dsh-termux` 指向 `lib/termux-bin.js`，并把**上一份安装
改名保留而非删除**。用 `--prefix DIR` 可装到别处（适合先空跑一遍），用 `--force` 可在有
`dsh web` 正在运行时强行继续。整个替换只有两次 rename，因此**运行中的 dsh 不会看到半写的树**。

装完之后：

```sh
dsh --version     # {{UPSTREAM}}
dsh web           # 打开它输出的 URL，注意其中的 ?token=...
```

## 自己验证这个构建

随包的这棵树自带检查，且**不需要任何服务商 API 密钥**：

```sh
cd "$PREFIX/lib/node_modules/dsh-termux"
node verify/flock-probe.mjs              # 真实的内核 flock 租约
node verify/fallback-primitives.mjs      # 硬链接回退行为正确
node verify/verify-termux.mjs            # 沙箱降级 + 附件链路
node verify/e2e-mock.mjs                 # 对着 mock LLM 跑完整 agent 回路
```

另有两个检查会**刻意触碰真实状态**：`verify/live-attachment-check.mjs` 会拿真实的
`~/.dsh` 跑附件存储（跑完会恢复原状）；`verify/attachment-e2e-verify.mjs` 用于检查一张
**通过 GUI 上传的图片** —— 上传**之前**先用 `--baseline` 记录基线，上传之后再跑一次。

## 卸载 / 回滚

```sh
# 回滚到上一份安装（如果之前装过）
rm -rf "$PREFIX/lib/node_modules/dsh-termux"
mv "$PREFIX/lib/node_modules/dsh-termux.bak-"* "$PREFIX/lib/node_modules/dsh-termux"

# 或彻底删除
rm -rf "$PREFIX/lib/node_modules/dsh-termux" "$PREFIX/bin/dsh" "$PREFIX/bin/dsh-termux"
```

## 包里有什么

| 路径 | 内容 |
|---|---|
| `dsh-termux/` | 构建出的包：`lib/`（CLI 本体）、`vendor/`（Termux 垫片）、`node_modules/` |
| `dsh-termux/verify/` | 上面列出的那些检查 |
| `dsh-termux/transform.js`、`patch-*.cjs` | 构建期产物，保留是为了让四处 Android 补丁**可审计** |
| `dsh-termux/package-lock.json` | 本次构建所依据的、已钉死的依赖树 |
| `install.sh` | 安装脚本 |
| `LICENSE` | MIT，覆盖本仓库自身的新增部分 |
| `THIRD-PARTY-NOTICES.md` | 本归档再分发所依据的上游 MIT 与 BSD-3-Clause 声明 |
| `SHA256SUMS`、`SYMLINKS.txt` | 逐文件完整性数据（所有符号链接均为相对路径） |
| `NOTES.md` / `NOTES.zh-CN.md` | 完整分析：四处 Android 阻塞点、打了什么补丁、为什么 |

## 已知限制

每条限制背后的证据，见 `NOTES.zh-CN.md`。

- **内核级沙箱不可用。** Android 不带 Landlock LSM，因此沙箱探针报 `unusable`，只有 DSH
  自身的文件策略生效；**没有内核强制的隔离层**，本该在受限环境中运行的辅助程序会以不受限
  方式运行。
- **会话在首次打开时会被前向重写。** 打开 0.1.0-rc.7 写下的会话会把它迁移到 v4 格式。
  上一代文件会留在磁盘上，但如果你可能需要回退，**先备份 `$DSH_HOME/sessions`**。
- **`dsh-termux` 没有发布到 npm。** 本归档就是分发渠道，没有可"更新自"的地方。
- 请通过 `dsh` 这个可执行文件启动。直接跑 `lib/bin.js` 会绕过 `lib/termux-bin.js`，
  而正是后者加上了 Android 上启动所必需的 `--expose-internals`。
