# 技术设计：供应商多选与批量操作

## 后端接口

- 新增 `POST /api/v1/channel/batch`，沿用 `/api/v1/channel` 的认证与 JSON 中间件。
- 请求支持两类范围：`scope=ids` 处理显式 ID 列表；`scope=filter` 使用供应商分页相同筛选语义解析全部匹配项，并排除 `exclude_ids`。
- 响应包含 `requested`、`succeeded`、`failed`、`success_ids`、`failed_items`。

## 后端执行

- 在 model 层定义批量请求与响应类型。
- 在 op 层抽出供应商筛选函数，供分页与批量 filter 复用。
- 批量启用、停用、删除逐个执行，每个 ID 独立记录结果，不做全局事务回滚。
- 空解析结果返回成功响应，计数全部为 0。

## 前端交互

- 在供应商表格首列增加原生 checkbox 选择列，不新增依赖。
- 状态由 `selectedIds`、`allFilteredSelected`、`excludedIds` 表示。
- 手动模式下跨页保留 `selectedIds`；筛选全选模式下以当前查询条件为范围，取消某行写入 `excludedIds`。
- 批量工具条展示已选数量、全选全部结果入口，以及启用、停用、删除、清空操作。
- 操作成功后 refetch；部分失败时 toast 显示数量并将失败 ID 设置为显式选择。

## 兼容性

- 不修改已有单条接口行为。
- 不引入数据库迁移。
- Go 项目没有 flasgger docstring 体系，新增接口按现有 handler 风格实现。
