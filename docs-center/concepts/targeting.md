---
title: "参与者与目标"
description: "participant scope、target scope、employee 和 team 目标之间的关系。"
---

# 参与者与目标

Lumirror 把“谁参与评价”和“评价谁”分开建模。

## Participant Scope

Participant Scope 决定可以进入活动并执行任务的参与者集合。

## Target Scope

Target Scope 决定最终需要被评价的对象集合。

成员活动可以通过指定团队、整个部门或自定义列表选出目标成员，但部门本身不是 target type。

```text
部门范围
→ 展开成员
→ 最终 target_type = employee
```

团队整体活动则直接生成：

```text
target_type = team
```

## excludeSelf

成员评价场景中，`excludeSelf` 用于避免参与者评价自己。它作用于任务生成逻辑，而不是改变组织结构或成员关系。

## inactive employee

inactive employee 不应产生新的评价任务。历史记录仍需保持兼容和可查询。
