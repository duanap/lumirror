---
title: "生产部署"
description: "Node + SQLite + PM2 + Nginx 的生产部署和发布检查。"
---

# 生产部署

## 生产组件

Lumirror 当前使用：

- Nginx
- Node.js production server
- SQLite
- PM2
- 单机持久化存储

PM2 当前保持：

```text
instances = 1
exec_mode = fork
```

不要为了“看起来并发”而主动切到 cluster。

## SQLite PRAGMA

运行时需要保持：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

## 发布 Gate

至少执行：

```bash
npm ci
npm audit
npm run check:functions
npm run test:api
npm run test:server
npm run test:golden
npm run test:r2:concurrency
npm run build
```

数据库检查：

```sql
PRAGMA quick_check;
PRAGMA foreign_key_check;
```

## 发布原则

Backend R2 的中间阶段即使合并到 `main`，也不代表可以自动部署生产。必须在明确 Release Gate 通过后单独决定生产发布。
