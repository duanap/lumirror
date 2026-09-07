---
title: "开发概览"
description: "Lumirror 开发栈、测试入口和架构演进原则。"
---

# 开发概览

## 技术栈

- Vue 3
- TypeScript
- Vite
- Element Plus
- Node.js
- SQLite
- PM2
- Nginx

## 本地开发

```bash
npm install
npm run dev:api
npm run dev
```

文档中心：

```bash
npm run docs:dev
```

## 文档构建

```bash
npm run docs:validate
npm run docs:build
```

生成目录为 `docs-dist/`，该目录是构建产物，不提交 Git。

## 架构演进原则

Backend R2 不是重写后端。目标是在保持现有业务行为、历史数据和 API contract 的前提下，把正常业务逐步从 Snapshot 整库写迁移到 Direct SQLite Repository 和短事务。
