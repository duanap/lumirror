---
title: "Backend R2"
description: "Direct SQLite Repository 迁移的当前状态、约束和后续阶段。"
---

# Backend R2

Backend R2 的核心目标是逐步移除正常业务对 Snapshot 整库写入的依赖。

## 已完成

评分链已经迁移到 Direct SQLite：

- current-task
- submit-score
- task progress
- verification progress
- timed invite progress
- results
- trends
- SQL aggregation
- `busy_timeout = 5000`
- concurrency Gate

## 当前禁止双写

任何业务操作只能选择一种写路径：

```text
Old Snapshot Path
```

或者：

```text
New Direct SQL Path
```

禁止同一业务操作同时执行 Direct SQL Write 和 `saveDatabase(snapshot)`。

## 下一阶段

Domain CRUD Migration 顺序：

```text
D1 Evaluation + Period
D2 Invite + Timed Invite + Admin Tasks
D3 Employee + Member Tags
D4 Department + Team
D5 User + Account
D6 Audit
D7 Import / Export
```

## requestQueue Removal Gate

只有满足以下条件后才能单独进入移除阶段：

```text
Normal Snapshot Mutation = NO
Concurrency Gate PASS
busy handling PASS
```

requestQueue 移除必须是独立 PR，不能和 Domain CRUD 混在一起。

当前 Request Queue Removal 阶段使用独立分支和真实 HTTP/SQLite 并发 Gate；
移除后仍保持 Schema 4、EdgeOne compatibility 和 PM2 单 fork 实例。
