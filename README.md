# 光途Work

本地 AI Agent 桌面客户端，配独立商业化控制面：用户注册购买套餐后登录客户端，由你们的网关接入三方模型并按用量扣配额。用户看不到上游厂商 Key。

## 能力

- 官网邮箱验证码注册并设置密码；客户端跳转官网授权登录，不再本地填密码
- 体验 / 专业 / 团队三档套餐，官网下单（开发环境模拟支付宝/微信）
- 体验 / 专业 / 团队三档套餐，官网下单（开发环境模拟支付宝/微信）
- OpenAI 兼容网关：多厂商路由、tool-calling、失败换路、按上游 usage 计量
- Ask / Craft / Plan，本地工具与办公技能
- 用量条、套餐到期拦截、技能/MCP/专家团按权益灰掉
- 管理后台：用户、套餐、供应商 Key、用量与毛利、发票、优惠码

## 开发

需要两个进程：

```bash
cd gt-workbench
npm install
npm run api
```

另开终端：

```bash
npm run dev
```

- 官网与后台：http://127.0.0.1:8787 （管理员 `admin@local` / `admin123`）
- 桌面客户端默认网关：`http://127.0.0.1:8787/v1`
- 首次打开客户端会进入「账户」页，点「打开官网登录」完成授权

上游模型 Key **只能**在后台配置：登录 http://127.0.0.1:8787/admin.html → 「供应商」→ 粘贴厂商 Key 并保存。未配置 Key 的供应商不可调用。不要写进 `.env`、桌面客户端或官网。Key 只存在服务端 `apps/api/data/workbench.db`。

如果 Electron 二进制下载过慢：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
```

## 验收（个人版闭环）

1. 打开官网注册（邮箱验证码 + 设置密码），或在客户端点「打开官网登录」授权
2. 后台填入 DeepSeek（或其它支持 function calling 的）Key
3. 客户端登录，不填任何厂商 Key
4. 工作空间选 `fixtures/sample-workspace`，Craft 发送：把这个目录里的 md 汇总成 `summary.md`
5. 后台「用量」能看到扣 Token

专业版：官网购买（模拟支付）后可用多模型、MCP。团队版解锁专家团与多席位字段。

## 安装包与更新

```bash
npm run build
```

electron-builder 会打 Windows NSIS 安装包。更新源为 API `GET /updates/latest.yml`。生产环境请配置代码签名（`CSC_LINK`）并把安装包与 `latest.yml` 放到更新服务器。

支付：开发环境为模拟到账。生产把 `/v1/orders/:id/pay` 换成支付宝/微信回调，不要在 Electron 窗内扣款。

## 测试

```bash
npm test
```
