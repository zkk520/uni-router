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

- `main` 分支推送后仅构建并推送 Docker `latest` 镜像
- 仅当推送 `v*` tag 时，GitHub Actions 才生成正式 Release 与多平台二进制压缩包
- Release 资产命名必须使用 `uni-router-<os>-<arch>.zip`
- 压缩包内可执行文件必须命名为 `uni-router`，Windows 为 `uni-router.exe`
- 自更新下载地址固定为 `https://github.com/zkk520/uni-router/releases/latest/download`
- 自更新 API 地址固定为 `https://api.github.com/repos/zkk520/uni-router/releases/latest`
- GitHub API 可选令牌环境变量固定为 `UNI_ROUTER_GITHUB_PAT`

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
