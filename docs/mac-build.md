# 光途Work Mac 测试包：给执行 AI 的编译步骤

只做 Mac 安装包编译。不要改业务代码，不要提交 git，不要读取或打印 `apps/api/.env`。

打包结果自动连接测试环境 `http://43.139.61.253:8787`。不要改这个地址。`npm run dev` 才连接本机，本任务不要启动开发服务。

## 0. 先判断能不能编

在终端执行：

```bash
uname -s
uname -m
node -v
```

- `uname -s` 不是 `Darwin`：立刻停止。这台机器不是 Mac，打不出 `.dmg`。不要改用 `npm run build`（那是 Windows 安装包）。
- `node -v` 主版本小于 20：停止，并说明需要 Node.js 20 或更高。
- 记下 `uname -m`：`arm64` 是 Apple 芯片，`x86_64` 是 Intel。安装包只包含当前这台 Mac 的架构。

确认仓库根目录里同时存在这两个文件：

- `package.json`（name 为 `gt-workbench`）
- `apps/desktop/package.json`（name 为 `@gt-workbench/desktop`）

下文命令都在仓库根目录执行。找不到仓库就停止，不要新建工程。

## 1. 安装依赖

```bash
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
npm install
```

`npm install` 失败就停止并原文报告错误，不要改 `package.json` 版本或依赖。

确认图标存在：

```bash
test -f apps/desktop/resources/icon.png && echo ICON_OK
```

没有 `ICON_OK` 就停止。

## 2. 读取版本号

```bash
node -p "require('./apps/desktop/package.json').version"
```

把输出记为 `VERSION`。不要修改 `apps/desktop/package.json` 的 `version`，除非操作者明确要求升版本。

## 3. 编译 Mac 安装包

`npm run build` 只会打 Windows，禁止使用。不要在仓库根目录执行 `electron-builder`。

测试包不使用 Apple 开发者证书。必须带上 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免 electron-builder 去找签名身份而失败。

```bash
cd apps/desktop
export CSC_IDENTITY_AUTO_DISCOVERY=false
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
npx electron-vite build
npx electron-builder --mac --publish never
cd ../..
```

不要同时打 `--win`。不要加 `--arm64 --x64`，两种架构的文件名会互相覆盖。

编译失败就停止并报告最后 80 行日志。不要改签名配置，不要创建 Apple 证书。

## 4. 验收产物

期望文件：

```text
apps/desktop/release/GuangtuWork-${VERSION}.dmg
```

执行：

```bash
ls -lh apps/desktop/release/*.dmg
```

成功标准：

- 存在且仅关注文件名 `GuangtuWork-${VERSION}.dmg`
- 文件大小大于 1MB
- 文件名以 `.dmg` 结尾

向操作者只报告这四项：dmg 的绝对路径、文件大小、`VERSION`、`uname -m` 的值。

不要上传服务器，不要启动客户端，不要执行 git commit。
