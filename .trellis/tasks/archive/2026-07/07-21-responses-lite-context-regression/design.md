# 技术设计：Responses Lite 跨协议 Header 隔离

## 根因

实际请求链路为：

```text
/v1/responses
  -> Responses 入站解析
  -> Key 有效类型 OpenAI Chat
  -> Chat 出站重建请求体（无 reasoning.context）
  -> 公共 Header 复制仍携带 Responses Lite Header
  -> 上游因 Header/Body 契约不一致返回 400
```

上一版同协议透明转发只覆盖 `Responses -> Responses`，其测试使用的也是 `OutboundTypeOpenAIResponse`，因此没有覆盖真实的 `Responses -> Chat` 配置。

## 运行配置

- “Pro 拼车”供应商默认协议保留 `OpenAI Chat`。
- 仅将报错 Key 的“Key 协议类型”从“继承默认协议”改为 `OpenAI Response`。
- `EffectiveChannelKeyType` 将选择 Key 覆盖值，使该 Key 的 `/v1/responses` 请求使用 Responses 出站适配器并命中透明路径。

## 代码边界

- 新增客户端 Header 转发判定，调用点保持在 `relayAttempt.copyHeaders`。
- 精确识别 `X-OpenAI-Internal-Codex-Responses-Lite`，比较不区分大小写。
- 当 `relayAttempt.keyType != OutboundTypeOpenAIResponse` 时跳过该客户端 Header。
- 当出站为 OpenAI Responses 时继续转发，不修改值，也不向请求体注入 `all_turns`。
- 其他客户端 Header 继续遵循现有认证、hop-by-hop 和代理 Header 过滤规则。
- 渠道自定义 Header 仍在客户端 Header 之后应用；显式渠道配置保持最高优先级。

## 数据流契约

| 入站 | 有效出站 | Lite Header | Body |
|---|---|---|---|
| Responses | OpenAI Responses | 保留 | 原始 Body，包含客户端提供的 context |
| Responses | OpenAI Chat | 过滤 | 使用 Chat 转换器 |
| Responses | NewAPI Chat | 过滤 | 使用 Chat 转换器 |
| 其他协议 | 非 Responses | 过滤（若客户端异常携带） | 现有转换行为 |

## 兼容与回滚

- 不改变路由选择、渠道类型、认证、URL、请求体转换或响应转换。
- 不对非 Lite 请求增加字段或 Header。
- 不改变非 2xx、故障转移和最终 502 契约。
- 如需回滚，只撤销 Header 判定提交；此前 `reasoning.context` 与同协议透明转发修复仍保留。

## 风险

- Chat 上游即使不再收到 Lite Header，也不保证支持 Codex 的全部 Responses 私有能力；因此当前故障的首选运行配置仍是 Key 覆盖为 `OpenAI Response`。
- 仅过滤已证实冲突的精确 Header，避免对其他 OpenAI 扩展 Header 做未经验证的广泛删除。
