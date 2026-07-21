# Responses 兼容与同协议透明转发

## 目标

修复 OpenAI Responses 请求中的 `reasoning.context` 在 uni-router 转换链路中丢失的问题，并为严格同构协议提供可回退的双向透明转发，避免供应商新增字段或 SSE 事件因固定结构转换而被过滤。

## 已确认事实

- `/v1/responses` 当前会把请求解析为 `InternalLLMRequest`，再由出站适配器重新生成 JSON，不是原始透传。
- 客户端的 `X-OpenAI-Internal-Codex-Responses-Lite` Header 会继续转发，但 `reasoning.context` 当前没有对应内部字段，因此会被丢弃。
- 同协议透明转发仍需保留路由选择、渠道认证、Header 安全过滤、统计和故障转移。
- 跨协议路由继续依赖现有统一模型和转换器。

## 需求

- Responses 入站、内部模型和出站完整保留 `reasoning.context`，不硬编码或自行校验取值。
- 严格同构协议默认使用双向透明转发，并可通过全局配置关闭。
- 透明请求必须保留原始请求体，同时使用目标渠道 URL、认证和自定义 Header。
- 成功响应及 SSE 必须保持原始状态、允许透传的 Header 和内容；统计解析不得影响客户端响应。
- 非 2xx、候选端点切换和最终 502 行为保持现状。
- 非同构协议继续使用现有转换链路。

## 验收标准

- [x] `reasoning.context=all_turns` 和 `current_turn` 可完整通过 Responses 转换链路，字段缺省时不输出。
- [x] Responses、OpenAI Chat/NewAPI Chat、Anthropic Messages、OpenAI Embeddings 的严格同构组合使用透明转发。
- [x] Volcengine、Gemini及跨协议组合仍使用转换器。
- [x] 未知请求字段、成功 JSON 响应字段和未知 SSE 事件不会被删除或改写。
- [x] 渠道认证、Header 过滤、自定义 Header 和查询参数优先级符合现有安全边界。
- [x] 已知 usage 仍可进入统计，旁路解析失败不影响响应。
- [x] `relay.transparent_same_protocol=false` 时完整回退到旧链路。
- [x] 上游错误和故障转移保持现有最终 502 契约。
- [x] `go test ./...` 通过。

## 不在范围

- 不新增数据库迁移或管理 API。
- 不取消或重构跨协议转换器。
- 不把 `reasoning.context` 全局强制为 `all_turns`。
- 不改变上游错误的现有客户端契约。
- 不自动执行 `git push`。
