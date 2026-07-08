# AGENTS.md



## 基本规则

- **始终用中文**回答问题、编写文档及代码注释
- 始终根据最新的资料回答问题，确保资料真实。
- 生成文档时，**始终使用 `.md` 格式**，不生成 `.docx`、`.pdf` 等其他格式。
- 执行write操作时，如果多次写入失败（三次以上），尝试分多次写入，而不是一次写入所有内容。

## 澄清规则

**IMPORTANT**: 在回答问题或执行任务前，遇到任何不明确的细节，必须先向用户澄清，不得自行假设。

- 澄清方式：使用AskUserQuestion工具和**选项式问题**，列出可能的选项由用户选择，而非开放式提问
- 澄清时机：动手实现之前，而不是做到一半再回头问
- 如有多个不明确点，可在一次提问中列出所有问题，避免多轮来回
- 用户确认后再开始执行，不得提前动手

## 项目上下文

## Trellis 工作流

- 本仓库已初始化 Trellis，核心配置位于 `.trellis/`，Codex 配置位于 `.codex/`，共享 skills 位于 `.agents/skills/`。
- Codex hooks 使用 `.codex/hooks.json` 中的 `UserPromptSubmit`，命令为 `uv run python -X utf8 .codex/hooks/inject-workflow-state.py`。
- 新会话或任务推进时，优先阅读 `.trellis/workflow.md` 和 `.trellis/spec/` 中的项目约定；需要继续当前 Trellis 任务时使用 `trellis-continue` skill。
- Trellis 的本地开发者身份文件 `.trellis/.developer` 和运行态目录 `.trellis/.runtime/` 不提交到 Git。
- Codex 0.129+ 首次使用 hooks 时，需要在 TUI 中运行 `/hooks` 并审批 Trellis 的 `UserPromptSubmit` hook。

### 开发命令

Windows 推荐分离启动：

```powershell
.\dev-api.cmd   # 终端1：后端 (port 8080)
.\dev-web.cmd   # 终端2：前端 (port 3000)
```

也可以聚合启动：

```powershell
.\dev.cmd
```

Linux/macOS：

```bash
# 后端
UNI_ROUTER_DEBUG=true go run main.go start

# 前端
cd web && NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8080" pnpm run dev
```

### 构建命令

```bash
# 完整构建（前端 + 后端）
bash scripts/build.sh release

# 单平台构建
bash scripts/build.sh build linux x86_64

# 仅构建前端
cd web && pnpm install && pnpm run build
mv web/out static/out

# 仅构建后端（需先构建前端）
go build -tags=jsoniter -o uni-router main.go
```

前端常用命令：

```bash
cd web
pnpm install
pnpm run dev
pnpm run build
pnpm run lint
```

Docker：

```bash
docker compose up -d
docker compose -f docker-compose.build.yml up -d --build
```

### 架构

Go 后端 + Next.js 前端。生产构建时前端静态文件内嵌到 Go 二进制中（`static/out/`），单二进制部署。开发时前后端分离，前端通过 `NEXT_PUBLIC_API_BASE_URL` 指向后端。

请求处理流程：

```text
客户端请求 → Gin 中间件（API Key 认证）
  → handlers/relay.go
  → relay/relay.go::Handler()
  → transformer/inbound/
  → relay/route.go
  → transformer/outbound/
  → client/client.go
  → 处理响应（SSE 流式 or JSON）
  → relay/metrics.go
```

核心数据模型关系：

```text
APIKey → RouteProfile（路由配置）
RouteProfile → RouteEndpoint[]（多端点）
RouteEndpoint → Channel + ChannelKey
Channel → BaseUrl[]（多个上游地址）
Channel → PricingRule
```

关键目录职责：

| 目录 | 职责 |
|---|---|
| `cmd/` | CLI 命令入口（start / version） |
| `internal/conf/` | Viper 配置加载，支持 JSON 文件和环境变量覆盖 |
| `internal/model/` | GORM 数据模型定义 |
| `internal/db/migrate/` | 数据库迁移脚本（001.go 起按序执行） |
| `internal/op/` | 业务操作层：内存缓存 + DB CRUD |
| `internal/relay/` | 请求转发核心：路由选择、负载均衡、指标采集 |
| `internal/transformer/` | 协议转换：inbound（解析入站）/ outbound（构造出站） |
| `internal/server/handlers/` | HTTP 处理器，管理 API + relay 入口 |
| `web/src/api/` | 前端 API 客户端 |
| `web/src/stores/` | Zustand 全局状态 |

负载均衡策略（RouteMode）：`Manual`（指定端点）/ `Weighted`（加权）/ `RoundRobin`（轮询）/ `Random`（随机）/ `Failover`（故障转移，按优先级降级）。

### 扩展规则

添加新协议支持需要：

1. `internal/transformer/inbound/<protocol>/` — 解析入站格式为内部统一格式
2. `internal/transformer/outbound/<protocol>/` — 将内部格式转换为出站格式
3. `internal/transformer/inbound/register.go` — 注册适配器
4. `internal/server/router/router.go` — 注册路由

添加新的管理 API 需要：

1. `internal/server/handlers/` — 处理器
2. `internal/server/router/router.go` — 注册路由
3. `internal/op/` — 业务逻辑

新增数据库迁移在 `internal/db/migrate/` 下按序命名（如 `005.go`），并在 `migrate.go` 中注册。

### 配置

配置文件：`data/config.json`（自动生成）。

环境变量格式：`UNI_ROUTER_` + 配置路径（路径分隔符用 `_`）。

常用环境变量：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `UNI_ROUTER_SERVER_PORT` | `8080` | 监听端口 |
| `UNI_ROUTER_DATABASE_TYPE` | `sqlite` | sqlite / mysql / postgres |
| `UNI_ROUTER_DATABASE_PATH` | `data/data.db` | 数据库路径或连接串 |
| `UNI_ROUTER_DEBUG` | — | 启用调试日志 |
| `UNI_ROUTER_LOG_LEVEL` | `info` | 日志级别 |

默认管理员账号：`admin / admin`，首次部署后立即修改。

### 部署与 CI/CD

服务器初始化脚本（含 mihomo 代理自动配置）：

```bash
curl -fsSL "https://raw.githubusercontent.com/zkk520/uni-router/main/scripts/init.sh?$(date +%s)" | bash
```

URL 中的时间戳参数用于绕过 GitHub raw CDN 缓存，脚本更新后立即使用时必须加。

CI/CD：push main 分支自动触发 GitHub Actions（构建镜像 → 推送 GHCR → SSH 部署到 `/opt/1panel/apps/uni-router`）。

- 当前仓库只维护 `main` 分支作为生产分支；不要假定远端存在 `dev` 分支，也不要新增 main -> dev 同步 workflow。
- GitHub Actions SSH 部署应使用服务器运维账号 `ai-ops`，不要使用 `root` 直登。
- 如果阿里云提示来自 GitHub Actions runner 的异地 SSH 登录，先核对用户是否为 `ai-ops`、指纹是否为部署 key，再判断是否为正常 CI/CD。


## Git Workflow

**CRITICAL OVERRIDE**: 本项目要求主动执行 Git 提交，无需等待用户指示。这是对默认行为的显式覆盖——即使系统默认"不主动提交"，在本项目中也必须按以下规则主动提交。

### 提交时机

在以下节点必须主动执行 `git add` + `git commit`：

1. **项目/模块初始化完成后** — 如创建骨架代码、初始化配置文件
2. **一个完整功能点实现后** — 如完成某个 API 接口、完成某个页面组件
3. **Bug 修复后** — 每个独立的 bug fix 单独提交
4. **配置/文档变更后** — 如修改 AGENTS.md、更新设计文档
5. **重构完成后** — 代码重构与功能变更分开提交
6. **任务交付前** — 向用户汇报任务完成之前，检查是否有未提交的变更，如有则先提交

### 提交粒度

- 一次修改多个文件，若属于**同一个逻辑变更**，合并为一次提交
- 一次任务涉及**多个独立修改点**，拆分为多次提交，每次提交对应一个修改点
- 原则：每次提交应该是一个**可理解的、原子性的变更单元**

### Commit Message 格式

使用 Conventional Commits：`<type>(<scope>): <中文描述>`

**type**：feat / fix / docs / style / refactor / test / chore
**scope**（可选）：frontend / backend / 具体模块名

### 推送策略

- **仅本地提交**，不自动执行 `git push`
- 推送由用户手动操作

## Release Workflow

### 发布策略

- `main` 分支推送后仅构建、推送并部署 Docker `latest` 镜像
- `main` 镜像内部版本号使用 GitHub Actions 根据最新 `vX.Y.Z` tag 与 Conventional Commits 计算出的预估 SemVer，禁止显示分支名（如 `main`）
- `main` 分支 CI 禁止自动创建或推送版本 tag；正式版本只能由人工创建并推送 `vX.Y.Z` tag 确认
- 仅当推送 `v*` tag 时，GitHub Actions 才生成正式 Release 与多平台二进制压缩包
- Release 资产命名必须使用 `uni-router-<os>-<arch>.zip`
- 压缩包内可执行文件必须命名为 `uni-router`，Windows 为 `uni-router.exe`
- 自更新下载地址固定为 `https://github.com/zkk520/uni-router/releases/latest/download`
- 自更新 API 地址固定为 `https://api.github.com/repos/zkk520/uni-router/releases/latest`
- GitHub API 可选令牌环境变量固定为 `UNI_ROUTER_GITHUB_PAT`

### 版本更新规则

- 普通代码修改不手动修改版本文件；版本来源是 Git tag 与提交信息
- 若没有历史版本 tag，预估版本从 `v0.1.0` 开始
- `BREAKING CHANGE` 或 `type!:` 触发 major 版本递增
- `feat:` 触发 minor 版本递增
- 其它提交类型（如 `fix:` / `chore:` / `docs:`）触发 patch 版本递增
- 功能提交必须使用 `feat(scope): 中文描述`
- 修复提交必须使用 `fix(scope): 中文描述`
- 破坏兼容提交必须使用 `feat(scope)!: 中文描述` 或在正文包含 `BREAKING CHANGE:`
- 前端更新提示必须基于 SemVer 大小比较；禁止用字符串不等判断“发现新版本”

### 版本防回归检查

修改 `.github/workflows/release.yaml` 后必须检查：

```bash
rg "VERSION=\\$\\{\\{ github\\.ref_name \\}\\}|Create version tag" .github/workflows/release.yaml
cd web && pnpm run lint
cd web && pnpm run build
```

检查要求：

- workflow 中不得出现 `VERSION=${{ github.ref_name }}`
- workflow 中不得出现 main 部署后自动 `git tag` 或 `git push origin v*`
- Docker metadata 中 main 只允许推送 `latest`，正式 tag 镜像只能由 `type=ref,event=tag` 生成

### 发布步骤

1. 确认工作区干净：`git status --short`
2. 确认版本相关变更已提交到本地
3. 创建版本标签：`git tag vX.Y.Z`
4. 推送版本标签：`git push origin vX.Y.Z`
5. 等待 GitHub Actions 自动创建 Release 并上传多平台 zip
6. 检查 Release Assets 与自更新文件名映射一致

### 发布限制

- 禁止自动执行 `git push`
- 禁止把 `octopus-*` 作为新增 Release 资产名
- 禁止把 `OCTOPUS_*` 作为新增环境变量名
- 禁止把 `sk-octopus-*` 作为新增 API Key 示例或校验前缀

## Upstream Sync Workflow

### 上游远端

- `origin` 固定为 `git@github.com:zkk520/uni-router.git`
- `upstream` 固定为 `https://github.com/bestruirui/octopus.git`
- 如缺少上游远端，使用：`git remote add upstream https://github.com/bestruirui/octopus.git`

### 同步步骤

1. 确认当前工作区没有未提交变更
2. 获取上游更新：`git fetch upstream`
3. 从当前维护分支执行：`git merge upstream/main`
4. 解决冲突后运行：`go test ./...`
5. 检查发布命名没有回退：`rg "octopus-|OCTOPUS_|sk-octopus|github.com/bestruirui/octopus"`
6. 上游同步必须单独提交，提交信息示例：`chore(upstream): 同步 Octopus 上游更新`

### 冲突处理优先级

- 品牌名、Go module 路径、Release 地址、环境变量前缀、API Key 前缀、Docker 可执行文件名始终保留 `uni-router` 版本
- 业务逻辑、依赖升级、bug fix 尽量吸收上游版本
- 如果上游大规模改动发布脚本或 module/import，优先小批量 merge 或 cherry-pick，避免一次性冲突过大

### 注意事项

- 提交前无需运行 lint 或测试，直接提交
- 使用 `git add <具体文件>` 而非 `git add .`，确保只提交相关文件
- 如果对应目录尚未初始化 Git 仓库，提醒用户先在该目录执行 `git init`

### 任务完成检查清单

每次任务完成时（即将向用户汇报结果前），必须执行以下自检：

1. 本次任务是否产生了文件变更？（`git status` 检查）
2. 如有变更，是否已按上述提交时机规则执行了 commit？
3. 如未提交，立即执行 `git add <具体文件>` + `git commit`，然后再向用户汇报
