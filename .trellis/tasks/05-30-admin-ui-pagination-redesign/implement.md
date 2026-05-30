# 管理后台 UI 与分页 API 改版实施清单

1. 后端新增分页工具、PageResponse 类型和各资源分页 op 方法。
2. 后端注册 `/page` handler，保留 `/list` 行为。
3. 补充后端分页单元测试。
4. 前端新增分页类型和 hooks，接入 channel/model/router/apikey/log 页面。
5. 重做 App Shell、NavBar、顶部栏、全局主题和基础控件视觉。
6. 将主要页面改为后台表格/列表形态，保留业务操作。
7. 更新 API Key Dashboard 和设置页容器风格。
8. 运行 `go test ./...`、`cd web && pnpm run lint`、`cd web && pnpm run build`。
9. 启动本地前端并用浏览器检查桌面/移动关键页。
10. 按项目规则提交本地 commit。
