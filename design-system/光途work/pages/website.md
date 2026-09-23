# Website Page Overrides

> **PROJECT:** 光途Work
> **Page Type:** Marketing / Auth / Account
> Rules here override Master only where the web surface differs from the desktop shell.

---

## Color

沿用 Master 客户端色板，不使用技能库默认青绿。

- 主 CTA：`#1A7FD4`
- 升级 / 续费：`#F97316`
- 页面底：`#F4F6FB`
- 顶栏：白底 + `#E2E8F0` 底边

## Layout

首页按客户端能力介绍，再进入套餐。内容区最大宽度 1080px。顶栏 sticky，高度 56px，锚点需预留 `scroll-margin-top`。

- 首屏：标题、两点行动、产品窗口（任务列表 + 对话 + 工作空间）
- 能力：任务、识图、创作、技能与专家、连接器、项目空间，六张等宽卡
- 场景：标签切换，不要横向滚动旅程
- 三步开始，然后套餐
- 套餐卡：价格、说明，以及额度、对话、模型、技能、文件、连接等分行要点。不罗列模型 ID，不展示具体额度数字
- 优惠码收到折叠项
- 登录/注册去掉空段落和短信入口

## Motion

入场只用透明度，配合最多 18px 的位移；悬停只改颜色、边框和阴影。背景光斑和产品窗口可以缓慢漂浮。`prefers-reduced-motion` 时关掉动画并直接显示内容。

## Typography

官网与客户端同一字体栈。Hero 标题 `font-weight: 650`，不要 400 的杂志体。

## Components

- 卡片 16px 圆角，与客户端 `.gt-card` 一致
- 输入框 12px 圆角，与 `.gt-input` 一致
- 登录 / 注册 / 授权卡：居中 max-width 420px，白卡片
- 套餐推荐档：`border-color: #1A7FD4`，不要黑框
- 可点元素 `cursor: pointer`，hover 只改颜色 / 背景，不位移
