# 实施计划：供应商多选与批量操作

## 步骤

1. 激活 Trellis 任务。
2. 修改 `internal/model/channel.go`，新增批量接口请求/响应类型。
3. 修改 `internal/op/page.go`，抽出供应商筛选函数并保持分页行为不变。
4. 修改 `internal/op/channel.go`，新增批量执行逻辑。
5. 修改 `internal/server/handlers/channel.go`，注册并实现 `/batch` handler。
6. 补充后端单测，覆盖 ids、filter、部分失败和空结果。
7. 修改 `web/src/api/endpoints/channel.ts`，新增批量 hook 与类型。
8. 修改 `web/src/components/modules/channel/index.tsx`，增加选择列、批量工具条、批量删除确认。
9. 运行验证命令并修复问题。
10. 仅暂存并提交本次相关文件。

## 验证命令

```bash
go test ./...
cd web && pnpm run lint
cd web && pnpm run build
```

## 风险点

- 需要避免覆盖用户已有无关改动，尤其是当前工作区已有 `web/src/components/modules/setting/Info.tsx` 修改。
- 筛选全选的前后端筛选语义必须一致。
- 批量删除会移除供应商、密钥和统计数据，前端必须二次确认。
