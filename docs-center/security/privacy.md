---
title: "隐私与日志"
description: "请求日志、评分内容、邀请码和匿名身份的记录规范。"
---

# 隐私与日志

## Observability 可以记录什么

Backend R2 已加入：

- `X-Request-ID`
- Structured Request Logs
- Slow Request Marker
- Health Metadata

这些能力用于定位请求和性能问题，不改变匿名评价边界。

## 禁止记录

```text
password
Authorization
Cookie
session
完整邀请码
完整 timed invite link
个人评分内容
```

## Audit 与普通日志

关键业务操作应进入 Audit Repository，但 Audit 也不能成为敏感数据旁路。审计应记录“发生了什么操作”，而不是复制密码、token、Cookie、完整邀请码或个人评分明细。

## 评价人身份

任务进度、时效链接状态和公开 API 都应避免返回 evaluator identity。匿名保护必须覆盖接口字段、错误信息和日志上下文，而不只是前端展示。
