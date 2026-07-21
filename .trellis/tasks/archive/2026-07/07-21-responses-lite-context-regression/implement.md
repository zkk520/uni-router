# 实施计划：Responses Lite 跨协议 Header 隔离

## 1. 激活前检查

1. 审阅 PRD 与设计边界，确认运行配置由用户在管理界面调整。
2. 激活 Trellis 任务。
3. 使用 `trellis-before-dev` 加载后端规范和相关思考指南。

## 2. 回归测试

1. 在 `internal/relay` 增加真实 `forward()` 回归：Responses 入站、OpenAI Chat 出站、客户端携带 Lite Header。
2. 先证明当前代码会把 Lite Header 发往 Chat 上游，并记录该测试在修复前失败。
3. 覆盖 OpenAI Chat 与 NewAPI Chat 两种非 Responses 出站类型。
4. 保留并扩充现有 Responses 同协议测试，断言 Lite Header 与 `reasoning.context=all_turns` 同时原样到达上游。
5. 断言普通客户端 Header、渠道认证及渠道自定义 Header 行为不变。

## 3. 实现

1. 在 relay Header 复制边界增加精确的协议专用 Header 判定。
2. 非 OpenAI Responses 出站过滤客户端 `X-OpenAI-Internal-Codex-Responses-Lite`。
3. OpenAI Responses 出站继续透传，不注入、不修改 `reasoning.context`。
4. 保持渠道自定义 Header 最后覆盖的现有规则。

## 4. 验证

1. 运行 `go test ./internal/relay/...`。
2. 运行 `go test -count=1 ./...`。
3. 运行 `go vet ./...`。
4. 使用 `trellis-check` 复核规范、数据流、测试有效性和工作区差异。
5. 使用 `trellis-break-loop` 记录上一版测试遗漏的根因类别和预防措施。

## 5. 交付

1. 更新 PRD 验收项和必要的后端规范。
2. 仅暂存本任务相关文件。
3. 本地提交：`fix(relay): 隔离 Responses Lite 跨协议请求头`。
4. 不执行 `git push`。
5. 提醒用户在管理界面将报错 Key 的协议覆盖为 `OpenAI Response`，再由用户推送部署后验证实际请求。

## 回滚点

- 代码回滚仅涉及客户端 Header 判定和对应测试。
- 运行配置可将 Key 协议恢复为继承默认值，但这会重新启用 Responses -> Chat 转换，不建议用于 Codex Responses Lite。
