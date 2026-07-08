# Uni Router 发布指南

本文是人工发布操作手册。项目约束的最高优先级来源仍是 `AGENTS.md`，CI / 发布实现契约的可执行规范沉淀在 `.trellis/spec/backend/quality-guidelines.md`。

## 发布模型

- `main` 是生产部署分支。
- 推送 `main` 会构建并部署 `ghcr.io/zkk520/uni-router:latest`。
- `main` 镜像内部显示 GitHub Actions 计算出的预估 SemVer。
- `main` CI 禁止创建或推送 Git tag。
- 只有人工推送 `vX.Y.Z` tag 才会创建正式 GitHub Release 和多平台 zip 资产。

## 版本计算规则

普通代码变更不手动修改版本文件。版本由最新 `vX.Y.Z` tag 加 Conventional Commits 推导：

| 提交信号 | 版本递增 |
|---|---|
| `BREAKING CHANGE` 或 `type!:` | major |
| `feat:` | minor |
| `fix:`、`docs:`、`chore:` 及其它类型 | patch |
| 没有历史 `vX.Y.Z` tag | `v0.1.0` |

为了让预估版本稳定可预测，提交信息使用以下格式：

```text
feat(scope): 中文描述
fix(scope): 中文描述
feat(scope)!: 中文描述
```

破坏兼容变更必须使用 `type!:`，或在提交正文包含 `BREAKING CHANGE:`。

## main 部署检查清单

推送 `main` 后检查 release workflow：

1. 打开本次提交对应的 GitHub Actions `release` workflow。
2. 确认 `resolve version`、`release`、`deploy` 都成功。
3. 确认服务器部署的镜像 tag 是 `ghcr.io/zkk520/uni-router:latest`。
4. 确认应用界面版本不显示 `main`。
5. 确认 `/api/v1/update/now-version` 返回值与界面版本一致。

## 正式发布检查清单

1. 确认本地工作区干净：
   ```bash
   git status --short
   ```
2. 根据最新 release tag 和提交信息决定下一个 `vX.Y.Z`。
3. 创建版本 tag：
   ```bash
   git tag vX.Y.Z
   ```
4. 只推送版本 tag：
   ```bash
   git push origin vX.Y.Z
   ```
5. 等待 GitHub Actions 创建 GitHub Release。
6. 确认每个 Release asset 都命名为 `uni-router-<os>-<arch>.zip`。
7. 确认 zip 内可执行文件命名为 `uni-router`，Windows 为 `uni-router.exe`。
8. 确认自更新地址仍固定为：
   - `https://github.com/zkk520/uni-router/releases/latest/download`
   - `https://api.github.com/repos/zkk520/uni-router/releases/latest`

## CI 防回归检查

修改 `.github/workflows/release.yaml`、`Dockerfile`、前端版本展示或更新检查逻辑后，执行：

```bash
rg "VERSION=\\$\\{\\{ github\\.ref_name \\}\\}|Create version tag" .github/workflows/release.yaml
cd web && pnpm run lint
cd web && pnpm run build
```

`rg` 命令必须没有匹配结果。如果匹配到 `VERSION=${{ github.ref_name }}` 或 `Create version tag`，说明 workflow 可能回退到把 `main` 显示为应用版本，或在 `main` 部署后自动创建正式版本 tag。

同时人工检查 Docker metadata 规则：

```yaml
tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=ref,event=tag
```

不要为 `main` 增加原始预估 SemVer 镜像 tag。
