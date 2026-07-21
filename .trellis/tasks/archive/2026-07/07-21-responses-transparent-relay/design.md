# 技术设计：Responses 兼容与同协议透明转发

## 阶段一：Responses reasoning context

- `InternalLLMRequest` 增加 `ReasoningContext string`。
- Responses 入站 `ResponsesReasoning` 读取 `context`，转换到内部字段。
- Responses 出站 `ResponsesReasoning` 写回 `context`；仅当 reasoning 任一支持字段存在时生成 reasoning 对象。
- 不校验枚举值，由供应商决定模型是否接受该值。

## 阶段二：透明数据路径

- 公共入站解析成功后复制原始 Body 到现有 `RawRequest`。
- 通过 `RawAPIFormat + OutboundType` 判断严格同构组合：
  - `openai/responses` -> OpenAI Responses
  - `openai/chat_completions` -> OpenAI Chat 或 NewAPI Chat
  - `anthropic/messages` -> Anthropic
  - `openai/embeddings` -> OpenAI Embeddings
- 命中透明路径时仍调用出站适配器生成 URL、认证和协议默认 Header，随后用 `RawRequest` 替换 Body 并更新长度。
- 入站查询参数与渠道 Base URL 查询参数合并；渠道参数优先，客户端不能覆盖渠道配置。
- Header 继续使用现有 hop-by-hop 和客户端认证过滤规则，渠道自定义 Header 最后覆盖。

## 响应与统计

- 非流式成功响应先读取原始 Body，复制允许透传的 Header 和上游 2xx 状态后原样写回。
- 使用 Body 副本调用现有出站/入站解析器，只为保留 usage 和日志统计；解析失败仅记录警告。
- 流式成功响应按读取到的原始字节直接写入客户端。
- 复制流数据送入有界、非阻塞旁路观察器；观察器解析已知 SSE 事件并更新现有统计。
- 旁路积压、关闭或解析失败时停止观察并记录警告，不阻塞、不取消、不改写客户端流。

## 配置与回退

- `Config` 增加 `Relay.TransparentSameProtocol bool`，配置键为 `relay.transparent_same_protocol`。
- 默认值为 `true`，环境变量为 `UNI_ROUTER_RELAY_TRANSPARENT_SAME_PROTOCOL`。
- 配置关闭或协议不匹配时，完整使用现有转换路径。
- 非 2xx 在发送任何客户端数据前继续进入现有故障转移逻辑，最终仍由现有 502 响应封装处理。

## 兼容性

- 透明路径只改变严格同构协议的成功数据面，不改变路由选择和端点健康状态。
- 跨协议转换、计费模型、数据库结构和管理 API 不变。
- 阶段一可独立保留；阶段二出现兼容问题时通过配置关闭。
