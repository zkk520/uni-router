# 管理后台 UI 与分页 API 改版 PRD

## 目标

将 uni-router 管理后台改成参考 Sub2API 的浅色后台风格，并为主要管理列表提供真实后端分页。改版保留 uni-router 品牌、现有 Logo、现有功能和旧 `/list` 接口兼容性。

## 范围

- 后端新增 `/api/v1/channel/page`、`/api/v1/model/page`、`/api/v1/router/page`、`/api/v1/apikey/page`、`/api/v1/log/page`。
- 前端主导航页全覆盖：仪表盘、供应商、路由、价格、日志、令牌管理、设置。
- API Key 登录后的 dashboard 也统一到新后台视觉语言。
- 不新增项目不存在的导航入口，不做服务器部署验证。

## 验收标准

- 新分页响应统一为 `{ items, total, page, page_size }`，分页参数为 `page` 和 `page_size`，页码从 1 开始，默认 20，上限 100。
- 旧 `/list` 接口继续返回数组。
- 新分页接口支持 `keyword`、`sort_by`、`sort_order` 以及各资源常用过滤项。
- 频道、模型、路由、日志、令牌页面采用后台表格/列表形态；频道和模型不再提供网格/列表切换。
- 桌面端为固定左侧栏和顶部栏；移动端为抽屉侧栏；内容区独立滚动，表格可横向滚动。
- 顶部栏不显示余额或金额徽标，显示现有账户信息、主题/语言/退出等操作。
- 浅色风格贴近参考图；深色模式保持可读可用。
- `go test ./...`、`cd web && pnpm run lint`、`cd web && pnpm run build` 通过，或记录无法通过的明确原因。
