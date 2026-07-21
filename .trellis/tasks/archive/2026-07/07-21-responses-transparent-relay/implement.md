# 实施计划：Responses 兼容与同协议透明转发

## 阶段一

1. 为统一请求模型和 Responses 入站/出站 reasoning 结构增加 context 字段。
2. 更新双向转换逻辑，保持值原样和缺省省略行为。
3. 新增 Responses 转换单测，覆盖 `all_turns`、`current_turn` 和缺省。
4. 运行 `go test ./...`。
5. 仅暂存阶段一文件并提交：`fix(transformer): 透传 Responses reasoning context`。

## 阶段二

1. 增加 Relay 配置结构、默认值和配置测试。
2. 在公共解析入口保存原始请求体，并实现严格同构协议判断。
3. 实现透明请求构造、查询参数合并和现有 Header 安全规则复用。
4. 实现非流式成功响应原样转发及旁路统计解析。
5. 实现 SSE 原始流转发和有界非阻塞旁路观察。
6. 新增 relay 测试，覆盖协议矩阵、未知字段、Header、查询参数、响应、SSE、配置回退和错误语义。
7. 更新 Markdown 配置文档。
8. 运行 `go test ./...`。
9. 仅暂存阶段二文件并提交：`feat(relay): 支持同协议透明转发`。

## 质量与收尾

1. 使用 `trellis-check` 检查规范、测试和跨层数据流。
2. 根据实现结果更新项目规范或记录无需更新的理由。
3. 确认工作区只剩 Trellis 运行态文件。
4. 归档任务并记录会话；不执行 `git push`。

## 风险与回滚点

- 第一阶段提交必须独立，透明路径回滚不能撤销 context 修复。
- 流式旁路不得对客户端链路产生背压；观察失败必须自动降级为仅转发。
- Header 与查询参数处理不得允许客户端覆盖渠道认证。
- 阶段二可通过 `relay.transparent_same_protocol=false` 即时回退。
