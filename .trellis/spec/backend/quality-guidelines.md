# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

### Release / Version Contract

Release workflow changes are infrastructure contracts. They must preserve the distinction between the continuously deployed `main` image and manually confirmed release tags.

#### Scope / Trigger

This contract applies whenever `.github/workflows/release.yaml`, `Dockerfile`, frontend version display, or update-check behavior changes.

#### Signatures

- Workflow output: `jobs.version.outputs.version`
- Docker build arg: `VERSION=${{ needs.version.outputs.version }}`
- Backend version endpoint: `GET /api/v1/update/now-version -> string`
- Frontend build env: `NEXT_PUBLIC_APP_VERSION`

#### Contracts

- `main` push builds, pushes, and deploys only `ghcr.io/zkk520/uni-router:latest`.
- `main` image internals may use a predicted SemVer from `jobs.version.outputs.version`, but CI must not create or push a Git tag.
- Only `vX.Y.Z` tag pushes create GitHub Releases and multi-platform zip assets.
- Docker metadata may use `type=ref,event=tag` for tag images, but must not add a raw predicted SemVer tag for `main`.
- The version injected into frontend and backend must come from the resolved SemVer output, not from the branch name.

#### Validation & Error Matrix

| Condition | Required Result |
|---|---|
| `github.ref == refs/heads/main` | push `latest`; no GitHub Release; no zip upload; no automatic tag creation |
| `github.ref == refs/tags/v*` | create GitHub Release; upload `uni-router-<os>-<arch>.zip`; publish tag image |
| no previous `vX.Y.Z` tag | resolve version as `v0.1.0` |
| commits contain `BREAKING CHANGE` or `type!:` | increment major |
| commits contain `feat:` | increment minor |
| other commit types | increment patch |
| frontend/backend version differs | show cache-mismatch warning |
| latest release is not greater than current SemVer | do not show update prompt |
| version is non-SemVer such as `dev` or `main` | do not show update prompt |

#### Good / Base / Bad Cases

- Good: `main` push injects `v0.1.1` into the app, pushes only `latest`, deploys successfully, and does not create `v0.1.1` tag.
- Base: `v0.1.1` tag push creates the official Release and uploads `uni-router-linux-x86_64.zip` style assets.
- Bad: `main` push injects `main` into the app UI or creates a tag automatically after deployment.

#### Tests Required

- Static workflow check:
  ```bash
  rg "VERSION=\\$\\{\\{ github\\.ref_name \\}\\}|Create version tag" .github/workflows/release.yaml
  ```
  This command must return no matches.
- Frontend checks after version-display or update-check changes:
  ```bash
  cd web && pnpm run lint
  cd web && pnpm run build
  ```
- Manual release verification: after pushing `vX.Y.Z`, verify Release assets and `/api/v1/update/now-version` agree with the tag.

#### Wrong vs Correct

Wrong:

```yaml
build-args: |
  VERSION=${{ github.ref_name }}

tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=raw,value=${{ needs.version.outputs.version }},enable=${{ github.ref == 'refs/heads/main' }}
```

Correct:

```yaml
build-args: |
  VERSION=${{ needs.version.outputs.version }}

tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=ref,event=tag
```

Wrong:

```typescript
const hasNewVersion = latestVersion !== backendNowVersion;
```

Correct:

```typescript
const hasNewVersion = isNewerSemVer(latestVersion, backendNowVersion);
```

### CI Deployment Must Fail on Pull or Health Failure

Deployment workflows that update Docker Compose services must treat image pull failures as hard failures. Do not continue to `docker compose up -d` after retries are exhausted, because that can leave the old container running while GitHub Actions reports a false success.

Required behavior for SSH deployment scripts:

- Retry `docker compose pull` with bounded backoff for transient registry/proxy errors.
- Exit non-zero if all pull attempts fail.
- Log the pulled image ID before `docker compose up -d`.
- Wait for the target container health check to become `healthy`.
- Compare the running container image ID with the pulled image ID and fail if they differ.

Wrong:

```bash
for i in 1 2 3; do
  docker compose pull && break
done
docker compose up -d
```

Correct:

```bash
pull_success=false
for delay in 10 20 30 60 90; do
  if docker compose pull; then
    pull_success=true
    break
  fi
  sleep "${delay}"
done

if [ "${pull_success}" != "true" ]; then
  exit 1
fi

pulled_image_id=$(docker image inspect ghcr.io/zkk520/uni-router:latest --format '{{.Id}}')
docker compose up -d
running_image_id=$(docker inspect uni-router --format '{{.Image}}')
if [ "${running_image_id}" != "${pulled_image_id}" ]; then
  exit 1
fi
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

## 场景：严格同构协议透明转发

### 1. 适用范围 / 触发条件

- 修改 LLM 请求转发、协议适配器、上游响应或 SSE 处理时适用。
- 当入站 `APIFormat` 与渠道 `OutboundType` 严格同构时，业务载荷不得因固定结构重新序列化而丢失未知字段。

### 2. 签名

- 原始请求：`InternalLLMRequest.RawRequest []byte`
- 原始协议：`InternalLLMRequest.RawAPIFormat APIFormat`
- 同构判定：`isTransparentProtocolPair(APIFormat, outbound.OutboundType) bool`
- 回退配置：`relay.transparent_same_protocol` / `UNI_ROUTER_RELAY_TRANSPARENT_SAME_PROTOCOL`

### 3. 契约

- 同构组合仅包括 Responses -> Responses、OpenAI Chat -> OpenAI/NewAPI Chat、Anthropic -> Anthropic、Embedding -> Embedding。
- 命中同构组合时保留原始请求 Body；目标 URL、渠道认证、Header 过滤和渠道自定义 Header 仍由 uni-router 控制。
- 成功响应和 SSE 原始内容直接返回；已知 usage 通过旁路解析采集。
- 旁路统计失败只能记录警告，不得阻塞、取消或改写客户端响应。
- 配置默认开启；关闭后必须完整回到现有转换链路。

### 4. 校验与错误矩阵

| 条件 | 必须行为 |
|---|---|
| 同构协议且配置开启 | 双向透明转发 |
| 跨协议、Volcengine 或 Gemini | 使用转换器 |
| 路由发生模型改写 | 使用转换器，避免原始 Body 携带旧模型 |
| 上游返回 2xx | 原样返回成功状态、允许的 Header 和内容 |
| 上游返回非 2xx | 不提前写客户端，继续现有故障转移 |
| SSE 旁路积压或解析失败 | 停止观察，继续原样转发 |
| 首 Token 超时 | 关闭上游 Body，并保持客户端未写入以允许切换端点 |

### 5. Good / Base / Bad

- Good：Codex Responses Lite 的 Header 与 `reasoning.context=all_turns` 同时原样到达上游。
- Base：Responses 请求路由到 Anthropic 时继续转换，不把 OpenAI 私有字段发送给 Anthropic。
- Bad：转发 Lite Header，却因结构体缺少字段而删除 `reasoning.context`。

### 6. 必需测试

- 单元测试同构协议矩阵和配置默认值、环境变量回退。
- `httptest` 断言原始请求字节、渠道认证、查询参数优先级和自定义 Header。
- 断言未知成功响应字段和未知 SSE 事件保持原始字节。
- 断言已知 usage 仍进入统计，旁路失败不影响响应。
- 断言非 2xx 与首 Token 超时发生前客户端响应尚未写入。

### 7. Wrong vs Correct

错误：

```go
// 同协议请求先解码再编码，未知字段会被静默删除。
body, _ := json.Marshal(internalRequest)
```

正确：

```go
// 适配器负责目标 URL 和认证，同协议数据面使用已保存的原始 Body。
outboundRequest, _ := adapter.TransformRequest(ctx, internalRequest, baseURL, key)
_ = prepareTransparentRequest(outboundRequest, internalRequest.RawRequest, baseURL, internalRequest.Query)
```

(To be filled by the team)
