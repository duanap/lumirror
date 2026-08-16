# 和光镜鉴 Lumirror

匿名反馈 · 公平成长。Lumirror 是面向企业团队的匿名评价系统，提供评价活动、邀请链接、邀请码、时效评价、组织权限和结果汇总。

## Current Behavior

- 评价活动通过随机短邀请链接分发，参与者输入随机 6 位数字邀请码后开始评价。
- 一次性时效链接首次打开后开始 5 分钟倒计时；提交完成或超时后不可再次打开。
- 公开评价端不显示个人评分结果；评分、校验和汇总均由服务端完成。
- 活动删除会同步清理关联任务、邀请码、时效链接和评分数据。
- 后台支持按活动管理邀请链接、邀请码和任务，并支持批量操作及逐项失败原因。
- 默认综合评分使用启用维度的等权平均，不进行固定比例折算。

## Stack

- Vue 3 + TypeScript + Vite
- Element Plus
- Edge-compatible API handler: `edge-functions/api/[[default]].js`
- Direct-server adapter: Node.js, SQLite storage, PM2 and Nginx

## Local Development

```bash
npm install
npm run dev:api
npm run dev
```

Frontend: `http://127.0.0.1:5173`  
Admin: `http://127.0.0.1:5173/admin/login`

Local development starts with `admin` / `admin123`; the first login requires a password change. Production bootstrap requires `INITIAL_ADMIN_PASSWORD`.

## Validation

```bash
npm run check:functions
npm run test:api
npm run test:server
npm run build
```

## Deployment

The active production target is a direct server deployment; see [SERVER_DEPLOYMENT.md](./SERVER_DEPLOYMENT.md). The older EdgeOne instructions remain in [EDGEONE_DEPLOYMENT.md](./EDGEONE_DEPLOYMENT.md) for reference only.

The current whole-database KV model has a confirmed concurrent-write loss scenario. See [CONCURRENCY_MIGRATION.md](./CONCURRENCY_MIGRATION.md) for the deterministic reproduction, target consistency contract, and safe migration sequence.

## Packaging

EdgeOne upload archives use the format `Lumirror-v<version>.zip`. Include only source and deployment configuration: `src`, `public`, `edge-functions`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, and `edgeone.json`.
