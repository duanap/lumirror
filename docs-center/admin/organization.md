---
title: "组织与成员"
description: "部门、团队、成员和成员标签的管理语义。"
---

# 组织与成员

## 部门与团队

部门和团队构成当前组织结构。删除组织节点前，应先做业务层检查并给出明确反馈，而不是只依赖数据库外键错误。

需要检查的关联通常包括：

- teams
- employees
- users
- evaluations

组织结构变化不能改写已经产生的历史 Score 语义。

## 成员

成员记录需要保持：

- department FK
- team FK
- status
- avatar mapping
- tag relations

inactive employee 不应进入新活动的任务生成。

## 成员标签

一个成员可以拥有多个标签。标签用于元数据和筛选：

```text
Tag = metadata
Tag != RBAC
```

删除标签只删除标签关系，不删除成员。
