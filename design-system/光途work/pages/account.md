# Account overrides

Master 浅色令牌全部生效。本页：

- 分区卡片与设置页一致：左侧 40×40 图标底 + 标题 + 一句说明
- 用量只展示百分比和进度条，不展示 token / 份额数字
- 「刷新额度」为描边次按钮 + Lucide `RefreshCw`；请求中旋转（`motion-safe:animate-spin`），结果用 `aria-live` 文字，不只改颜色
- 升级套餐用 CTA 橙，退出为描边。全部 `cursor-pointer`，hover 只改颜色 200ms
