# 管理后台 UI 与分页 API 改版设计

## 后端接口

新增通用分页响应类型，保留现有 `/list` 返回数组。各 `/page` handler 解析统一分页参数并调用 op 层分页查询。默认排序为 `id desc`，模型为 `name asc`。

分页接口支持：

- channel：`keyword`、`enabled`、`type`、`sort_by`、`sort_order`
- model：`keyword`、`provider`、`priced`、`sort_by`、`sort_order`
- router：`keyword`、`mode`、`sort_by`、`sort_order`
- apikey：`keyword`、`enabled`、`router_id`、`sort_by`、`sort_order`
- log：复用现有过滤参数，并新增 `/page` 包装为分页响应

## 前端结构

App Shell 改为后台布局：`AppContainer` 负责桌面侧栏、移动抽屉、顶部栏和内容区。`NavBar` 改为分组菜单。Toolbar 改为表格页筛选/搜索/创建动作，不再承担频道/模型视图切换。

主要页面从卡片/网格转为表格：

- 供应商：展示名称、协议、密钥数、模型数、状态、请求/成本、操作。
- 模型：展示模型、供应商分组、输入/输出/缓存价格、计费状态、操作。
- 路由：左侧列表与右侧详情保留，但列表和详情容器统一后台表格/面板风格。
- 日志：使用分页表格，保留过滤和详情查看。
- 令牌：使用分页表格，保留创建、编辑、复制、统计、删除。

## 视觉系统

全局 token 改为浅青背景、白卡片、细边框、柔和阴影和青绿色主色。卡片/表格/弹窗圆角使用 8px 为主。保留 lucide 图标和 Radix/shadcn 基础组件。

## 兼容性

不改变 relay 协议，不删除旧 hook。前端新表格页优先使用 `/page`，仍保留旧 list hooks 给创建弹窗、路由详情等需要全量数据的场景使用。
