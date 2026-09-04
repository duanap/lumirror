# 和光镜鉴 Lumirror

匿名反馈 · 公平成长。Lumirror 是面向企业团队的匿名评价系统，提供评价活动、邀请链接、邀请码、时效评价、组织权限和结果汇总。

## Current Behavior

- 评价活动通过随机短邀请链接分发，参与者输入随机 6 位数字邀请码后开始评价。
- 一次性时效链接首次打开后开始 5 分钟倒计时；提交完成或超时后不可再次打开。
- 公开评价端不显示个人评分结果；评分、校验和汇总均由服务端完成。
- 活动删除会同步清理关联任务、邀请码、时效链接和评分数据。
- 后台支持按活动管理邀请链接、邀请码和任务，并支持批量操作及逐项失败原因。
- 评价活动可选择给成员评分或给团队整体评分，两类结果相互独立；参与成员可来自指定团队或整个部门，成员目标可来自指定团队、整个部门或自定义成员列表。
- 活动必须完整位于评价周期内；已结束活动可归档，归档只影响后台主列表，不删除历史数据。
- 默认综合评分使用启用维度的等权平均，不进行固定比例折算。

## 功能与体验

### 公开评价端

- 参与者通过 8 位邀请链接和 6 位邀请码进入；也可使用一次性时效链接，首次打开后开始 5 分钟倒计时。
- 每次评价聚焦一个对象：成员评价展示头像、姓名、性别、团队和岗位，团队评价展示团队、所属部门和成员数；提交后自动进入下一个对象，全部完成后进入成功页。
- 默认评分维度为“工作能力、工作态度、协作能力”。输入框即时校验分数范围，显示完成状态，并实时计算综合总分。
- 总分下方根据当前活动实际启用的评分维度动态展示计分公式；默认三项等权活动显示 `综合总分=(工作能力 + 工作态度 + 协作能力) / 3`，自定义权重或扣减项显示对应的真实计算规则。
- 评价人只能看到自己的剩余评价人数和进度；个人评分结果不会在公开端展示。

### 后台管理

- 数据概览按评价活动和团队展示参与人数、完成率、待办数量、任务数和平均综合分。
- 可维护部门、团队、成员、岗位、启停状态和多个自定义成员标签；标签仅用于标记，不会改变后台权限。
- 成员头像使用男女各 4 张 WebP 正常图与缩略图；列表延迟加载缩略图，公开评价首屏加载正常图，已有 avatar ID 保持兼容。
- 支持管理员、团队长、领导和成员等角色权限。成员账号不展示团队整体进度、个人评分结果或其他成员信息。
- 创建后台账号时可选择是否要求首次登录强制修改密码；需要改密时使用不可跳过的弹窗，成功后自动进入后台首页。
- 可按评价周期创建成员评价或团队整体评价活动，并同步生成邀请链接、邀请码和评价任务；使用已有周期时活动时间自动限制在周期边界内。
- 评价活动支持“全部、进行中、已结束、已归档”视图；归档活动只读，可恢复归档且不会删除评分、任务、邀请码或时效链接。
- 时效链接后台展示未开始、评价中、已完成、已过期状态及真实任务进度 `已完成 / 总任务`。
- 趋势看板按活动汇总员工或团队综合平均分，支持时间筛选；团队趋势只使用团队整体评价，并包含归档活动历史。
- 每个活动可单独配置 1–12 个评分维度、分值范围、增加/减少计入方向、计入比例、启用状态和取整方式。
- 提供评价任务查看与修复、结果查看、JSON 导入导出、匿名会话时长和日志保留期设置。

### 视觉与交互细节

- 公开端采用暖橙色卡片风格：圆角、渐变主按钮、轻阴影、橙色输入焦点和绿色完成态；被评价人的头像悬浮在评分卡顶部。
- 评分行在桌面端按“图标、维度说明、输入框、单位”对齐；移动端会压缩头像、字号、行高和间距，保留单手输入与清晰的分数范围提示。
- 后台使用可折叠侧边导航、固定顶部栏和卡片化数据区。表格、筛选工具栏和操作区会在小屏幕折行。
- 后台支持浅色、深色和自动主题；自动主题在每天 19:00–08:00 启用深色，也可由用户手动切换。
- 女性性别标签使用透明背景，避免产生额外的白色底块。

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

The direct-server deployment stores business entities in relational SQLite tables and serializes writes. Evaluation targets are persisted as a target type plus target ID so existing member results and new team results share one task workflow without mixing. The optional EdgeOne KV adapter remains snapshot-based; see [CONCURRENCY_MIGRATION.md](./CONCURRENCY_MIGRATION.md) for its deterministic concurrency reproduction and migration boundary.

## Packaging

EdgeOne upload archives use the format `Lumirror-v<version>.zip`. Include only source and deployment configuration: `src`, `public`, `edge-functions`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, and `edgeone.json`.
