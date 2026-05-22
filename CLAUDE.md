# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 开发命令

### 启动开发环境

```powershell
# 推荐：分离启动
.\dev-api.cmd   # 终端1：后端 (port 8080)
.\dev-web.cmd   # 终端2：前端 (port 3000)

# 或聚合启动
.\dev.cmd
```

Linux/macOS：
```bash
# 后端
UNI_ROUTER_DEBUG=true go run main.go start

# 前端
cd web && NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:8080" pnpm run dev
```

### 构建

```bash
# 完整构建（前端 + 后端）
bash scripts/build.sh release

# 单平台构建
bash scripts/build.sh build linux x86_64

# 仅构建前端
cd web && pnpm install && pnpm run build
# 然后移动产物
mv web/out static/out

# 仅构建后端（需先构建前端）
go build -tags=jsoniter -o uni-router main.go
```

### 前端命令

```bash
cd web
pnpm install          # 安装依赖
pnpm run dev          # 开发模式
pnpm run build        # 生产构建（输出到 out/）
pnpm run lint         # ESLint 检查
```

### Docker

```bash
docker compose up -d                                    # 使用 GHCR 镜像
docker compose -f docker-compose.build.yml up -d --build  # 从源码构建
```

## 架构

### 整体结构

Go 后端 + Next.js 前端。生产构建时前端静态文件内嵌到 Go 二进制中（`static/out/`），单二进制部署。开发时前后端分离，前端通过 `NEXT_PUBLIC_API_BASE_URL` 指向后端。

### 请求处理流程

```
客户端请求 → Gin 中间件（API Key 认证）
  → handlers/relay.go
  → relay/relay.go::Handler()        # 解析请求
  → transformer/inbound/             # 入站协议转换（OpenAI/Anthropic → 内部格式）
  → relay/route.go                   # 负载均衡 / 故障转移，选择 Channel + Key
  → transformer/outbound/            # 出站协议转换（内部格式 → 目标 API 格式）
  → client/client.go                 # 发送到上游
  → 处理响应（SSE 流式 or JSON）
  → relay/metrics.go                 # 记录统计（token、成本、延迟）
```

### 核心数据模型关系

```
APIKey → RouteProfile（路由配置）
RouteProfile → RouteEndpoint[]（多端点）
RouteEndpoint → Channel + ChannelKey
Channel → BaseUrl[]（多个上游地址）
Channel → PricingRule
```

### 关键目录职责

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

### 负载均衡策略（RouteMode）

`Manual`（指定端点）/ `Weighted`（加权）/ `RoundRobin`（轮询）/ `Random`（随机）/ `Failover`（故障转移，按优先级降级）

### 协议转换扩展

添加新协议支持需要：
1. `internal/transformer/inbound/<protocol>/` — 解析入站格式为内部统一格式
2. `internal/transformer/outbound/<protocol>/` — 将内部格式转换为出站格式
3. `internal/transformer/inbound/register.go` — 注册适配器
4. `internal/server/router/router.go` — 注册路由

### 添加新的管理 API

1. `internal/server/handlers/` — 处理器
2. `internal/server/router/router.go` — 注册路由
3. `internal/op/` — 业务逻辑

### 数据库迁移

新增迁移在 `internal/db/migrate/` 下按序命名（如 `005.go`），在 `migrate.go` 中注册。

## 配置

配置文件：`data/config.json`（自动生成）

环境变量格式：`UNI_ROUTER_` + 配置路径（路径分隔符用 `_`）

常用环境变量：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `UNI_ROUTER_SERVER_PORT` | `8080` | 监听端口 |
| `UNI_ROUTER_DATABASE_TYPE` | `sqlite` | sqlite / mysql / postgres |
| `UNI_ROUTER_DATABASE_PATH` | `data/data.db` | 数据库路径或连接串 |
| `UNI_ROUTER_DEBUG` | — | 启用调试日志 |
| `UNI_ROUTER_LOG_LEVEL` | `info` | 日志级别 |

默认管理员账号：`admin / admin`，首次部署后立即修改。

## 部署

服务器初始化脚本（含 mihomo 代理自动配置）：

```bash
curl -fsSL "https://raw.githubusercontent.com/zkk520/uni-router/main/scripts/init.sh?$(date +%s)" | bash
```

**注意**：URL 中的时间戳参数用于绕过 GitHub raw CDN 缓存，脚本更新后立即使用时必须加。

CI/CD：push main 分支自动触发 GitHub Actions（构建镜像 → 推送 GHCR → SSH 部署到 `/opt/1panel/apps/uni-router`）。
