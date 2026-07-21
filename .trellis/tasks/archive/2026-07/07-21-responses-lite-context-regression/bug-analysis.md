# Bug Analysis：Responses Lite Header 跨协议泄露

## 1. 根因类别

- **类别 B：跨层契约**。客户端 Header 的转发规则没有与入站 API 格式和渠道 Key 的有效出站类型建立契约。
- **类别 D：测试覆盖缺口**。上一版测试固定使用 OpenAI Responses 出站，只验证了同协议透明路径，没有覆盖真实配置中的 Responses -> Chat/NewAPI Chat。
- **具体原因**：渠道默认协议为 OpenAI Chat，报错 Key 原先继承默认协议。Responses 请求体被转换为 Chat 格式后不再包含 `reasoning.context`，但公共 Header 复制仍把 Responses Lite Header 发往上游。

## 2. 为什么上一版修复未解决

1. 显式传递 `reasoning.context`：只修复 Responses 固定结构转换到 Responses 的字段丢失，无法作用于 Chat 出站。
2. 同协议透明转发：设计正确，但真实 Key 的有效类型不是 Responses，因此没有命中该路径。
3. 测试模型不完整：测试直接构造 `OutboundTypeOpenAIResponse`，没有覆盖渠道默认类型和 Key 覆盖类型决定的真实路由分支。

## 3. 预防机制

| 优先级 | 机制 | 具体行动 | 状态 |
|---|---|---|---|
| P0 | 运行配置 | Codex Responses Lite 使用的 Key 覆盖为 OpenAI Response | DONE |
| P0 | 架构 | Header 转发按入站格式和有效出站类型过滤协议专用 Header | DONE |
| P0 | 测试 | 用完整 `forward()` 覆盖 Responses -> OpenAI Chat/NewAPI Chat | DONE |
| P1 | 规范 | 在后端质量规范记录协议专用 Header 与有效 Key 类型契约 | DONE |

## 4. 系统性扩展

- **相似风险**：其他供应商私有 Header 也可能在跨协议转换后与重建的 Body 不一致；新增此类 Header 时必须明确协议所有权。
- **设计改进**：客户端 Header 复制不能只区分 hop-by-hop 与端到端，还需要识别协议专用 Header。
- **流程改进**：协议网关测试必须使用渠道/Key 的有效出站类型覆盖同协议和跨协议矩阵，不能只验证理想配置。

## 5. 知识沉淀

- [x] 更新 `.trellis/spec/backend/quality-guidelines.md`。
- [x] 增加跨协议真实转发回归测试。
- [x] 保留同协议 Responses 的 Header 与原始 Body 回归测试。
- [x] 仓库不存在 `src/templates/markdown/spec/`，无模板副本需要同步。
