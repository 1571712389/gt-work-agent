# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** 光途Work
**Generated:** 2026-09-16
**Updated:** 2026-09-22
**Category:** Desktop AI Agent / Productivity

浅色专业工作台。参考常见桌面 Agent 的信息架构（图标栏 + 任务列表 + 对话 + 工作空间），使用自有品牌「光途Work」与圆形几何 Logo。官网与桌面客户端共用同一套色板与字体，用户从浏览器走进客户端时不应感到换了一套产品。

---

## Global Rules

### Color Palette（浅色，与桌面客户端一致）

| Role | Hex | CSS Variable | Usage |
|------|-----|--------------|-------|
| Primary | `#1A7FD4` | `--color-primary` | Logo 蓝、主按钮、选中态 |
| Accent | `#0369A1` | `--color-accent` | 链接悬停、强调 |
| CTA | `#F97316` | `--color-warn` | 升级、续费、警告 |
| Canvas | `#F4F6FB` | `--color-ink` | 页面底色 |
| Panel | `#FFFFFF` | `--color-panel` | 顶栏、卡片、侧栏 |
| Raised | `#F1F5F9` | `--color-raised` | 输入底、悬停 |
| Line | `#E2E8F0` | `--color-line` | 分割线 |
| Text | `#0F172A` | `--color-text` | 正文（对比度 ≥ 4.5:1） |
| Muted | `#475569` | `--color-muted` | 辅助文字下限 |

**Color Notes:** Trust blue from brand logo + orange only for upgrade. Light surfaces only. Do not substitute teal.

### Typography

- **Heading / Body:** Plus Jakarta Sans + Noto Sans SC
- **Mood:** friendly, modern, saas, clean, professional
- Chinese UI uses Noto Sans SC for glyphs; Latin uses Plus Jakarta Sans.
- Page titles: `font-weight: 650`, `letter-spacing: -0.03em`
- Do not use ultra-light editorial headings.

### Spacing

8px base: 4 / 8 / 16 / 24 / 32

### Shadows

- `--shadow-sm`: `0 1px 2px rgba(15,23,42,0.04)`
- `--shadow-md`: `0 8px 24px rgba(15,23,42,0.08)`
- `--shadow-lg`: `0 16px 40px rgba(15,23,42,0.12)`

### Motion

- Color / opacity / shadow / border transitions **150–200ms ease**
- No scale / translateY hover that shifts layout
- `prefers-reduced-motion` disables animation

### Components

- **Primary button:** `#1A7FD4` fill, white text, 12px radius, hover `#156db8`
- **Ghost button:** transparent, `#E2E8F0` border, hover raised bg
- **Card:** white, 16px radius, 1px line, `--shadow-sm`
- **Input:** 12px radius, focus ring `0 0 0 3px rgba(26,127,212,0.16)`
- **Focus:** `2px solid #1A7FD4`

---

## Desktop Shell

1. 64–76px 白底图标栏，顶部 Logo，底部账户
2. 280px 任务列表：搜索 + 新建 + 会话
3. 主对话：浅灰底、居中气泡、底部输入卡
4. 右侧工作空间面板白底

---

## Anti-Patterns

- ❌ 深色 OLED / 霓虹赛博朋克
- ❌ 青绿 / Teal 替代品牌蓝
- ❌ Emoji 当图标
- ❌ Hover scale / translateY 造成布局跳动
- ❌ 辅助文字浅于 `#475569`
- ❌ 黑色主按钮（石色调编辑风格）
- ❌ 复制腾讯 / WorkBuddy 商标与吉祥物
