---
title: "部署运维"
description: "Lumirror 当前生产架构、运行约束和运维边界。"
---

# 部署运维

当前正式生产架构为：

```text
Nginx
  ↓
Node production-server
  ↓
Global requestQueue
  ↓
Backend API Core
  ↓
SQLite
```

历史 EdgeOne 兼容结构仍保留，但当前正式生产不依赖 EdgeOne。

## 当前运行约束

- SQLite Schema Version：4
- `requestQueue`：保留
- PM2：单实例、fork 模式
- EdgeOne 兼容：保留
- Backend R2 未达到完整 Release Gate 前：不部署半完成迁移

## 为什么 requestQueue 还不能删

仍有正常业务 mutation 使用旧 Snapshot 写入时，Direct SQL 写和旧 Snapshot 可能发生覆盖冲突。只有正常 Snapshot Mutation 全部迁移后，才允许进入独立的 requestQueue Removal Gate。

[查看生产部署 →](/operations/deployment/)
