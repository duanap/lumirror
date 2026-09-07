---
title: "时效链接"
description: "一次性时效评价链接的状态、进度和过期语义。"
---

# 时效链接

时效链接用于给特定参与者提供一次性、有限时间的评价入口。

## 状态

后台状态包括：

```text
未开始
评价中
已完成
已过期
```

内部状态优先级为：

```text
completed
>
expired
>
in_progress
>
unused
```

这意味着已经完成的链接不会因为随后达到过期时间而被展示成“已过期”。

## 进度字段

系统可以维护：

- `completedTasks / totalTasks`
- `remainingTasks`
- `firstOpenedAt`
- `expiresAt`
- `completedAt`

## 首次打开

时效倒计时从首次打开开始。超过有效期后，未完成任务不能继续提交。

## 隐私边界

时效链接进度接口可以返回任务数量和时间状态，但不能泄露评价人身份、个人评分明细或可用于还原邀请码的敏感信息。
