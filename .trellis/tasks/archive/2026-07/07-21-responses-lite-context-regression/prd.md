# 排查 Responses Lite context 仍丢失

## 目标

定位并修复已部署 uni-router 经 `/v1/responses` 转发时仍触发 `reasoning.context` 缺失错误的问题，确保 Codex Responses Lite 请求经实际路由链路后满足上游要求，同时不破坏跨协议转换、模型路由和故障转移。

## 已知事实

- 客户端访问 `http://10.126.126.1:8090/v1/responses` 时，uni-router 最终返回 502；其上游端点实际返回 400，提示 `X-OpenAI-Internal-Codex-Responses-Lite requires reasoning.context to be all_turns`。
- 仓库已有提交 `c81dddc`，在 Responses 固定结构转换链路中显式传递 `reasoning.context`。
- 仓库已有提交 `a6e8f59`，为严格同构协议增加默认开启的双向透明转发。
- 相同供应商直连可成功，因此需要核对实际部署版本、运行配置、渠道出站类型、透明路径判定以及上游最终收到的请求体。
- GitHub 远端 `main` 当前为 `f5ad091`，已包含 `c81dddc` 和 `a6e8f59`；2026-07-21 对应 GitHub Actions 的镜像构建与 SSH 部署任务均成功，因此不能再以“修复仅存在本地”解释当前故障。
- 当前透明路径仅允许 `OpenAI Responses -> OpenAI Responses`。若渠道或渠道密钥的有效类型为 OpenAI Chat/NewAPI Chat，Responses 入站会走跨协议转换，请求体不再是 Responses 格式。
- `copyHeaders` 会继续转发 `X-OpenAI-Internal-Codex-Responses-Lite`，但 Chat 出站请求不会生成 Responses 的 `reasoning.context`。因此“Responses Lite Header + Chat/NewAPI 出站类型”可以稳定复现相同上游 400。
- 远端管理接口需要认证，当前会话没有可用的已登录浏览器控制接口；不能在不猜测凭据的前提下读取远端渠道和密钥类型。
- 用户截图确认“Pro 拼车”渠道默认协议类型为 `OpenAI Chat`，报错密钥选择“继承默认协议（OpenAI Chat）”；因此该请求的有效出站类型确定为 OpenAI Chat，不是 OpenAI Responses。
- 该配置使 `/v1/responses` 进入 `Responses -> Chat` 跨协议转换：原始 Responses Body 不会透明转发，Chat 出站也不会包含 `reasoning.context`，但当前公共 Header 复制逻辑仍会把 `X-OpenAI-Internal-Codex-Responses-Lite` 发往上游，形成上游明确拒绝的 Header/Body 组合。
- 用户已将报错 Key 的协议覆盖改为 `OpenAI Response`；等待实际请求复测结果，以确认当前故障是否已消失。
- 用户复测确认调用成功，原 `reasoning.context must be all_turns` 错误已消失；实际根因已由运行配置修正验证。

## 需求

- 用可复现证据确认失败发生在部署版本、配置、透明判定、请求解析、模型改写或请求构造中的哪一层。
- 修复实际根因，不以全局硬编码 `reasoning.context=all_turns` 掩盖问题。
- 对真实失败路径增加回归测试，测试必须在修复前能够复现失败。
- 保持客户端认证过滤、渠道认证、跨协议转换、故障转移和最终 502 契约不变。
- 提供可验证当前运行实例是否包含修复的检查方式。
- 当前报错密钥在管理界面改为覆盖协议 `OpenAI Response`，使 `/v1/responses` 命中同协议透明转发；供应商默认协议可继续保留 `OpenAI Chat`。
- 当 Responses 入站被配置为 Chat/NewAPI 等非 Responses 出站时，不得把客户端的 `X-OpenAI-Internal-Codex-Responses-Lite` Header 转发给上游。
- OpenAI Responses 同协议出站必须继续保留该 Lite Header 和原始 `reasoning.context`。

## 验收标准

- [x] 明确记录实际根因以及上一版测试未覆盖该根因的原因。
- [x] Codex Responses Lite 请求经真实渠道类型和路由配置后不再触发上游 context 校验错误。
- [x] 报错密钥覆盖协议改为 `OpenAI Response` 后，实际请求命中同协议透明转发并成功完成。
- [x] Responses -> OpenAI Chat/NewAPI Chat 转换时，上游不再收到 Responses Lite 专用 Header。
- [x] Responses -> OpenAI Responses 时，上游仍同时收到 Lite Header 与原始 `reasoning.context=all_turns`。
- [x] 非 Lite 请求不被擅自注入或改写 `reasoning.context`。
- [x] 跨协议或模型改写路径继续使用转换器且正确保留受支持字段。
- [x] 上游非 2xx 仍在客户端响应写入前进入现有故障转移流程。
- [x] 相关 Go 测试与质量检查通过。
- [x] 变更按项目规则本地提交，不执行 `git push`。

## 暂不纳入范围

- 不改变供应商自身的模型能力或校验规则。
- 不新增数据库迁移或管理 API，除非排查证据证明这是修复所必需。
- 不自动部署或推送远端。
- 不自动推断或改写渠道/密钥协议类型。
- 不扩展过滤其他尚未证实存在跨协议冲突的 `X-OpenAI-Internal-*` Header。

## 待确认

- 无。用户已选择“修正该 Key 协议 + 增加跨协议 Header 过滤”。
