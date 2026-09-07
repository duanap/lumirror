---
title: "结果与趋势"
description: "员工结果、团队整体结果与历史趋势的正确汇总方式。"
---

# 结果与趋势

## 员工结果

员工结果只来自：

```text
target_type = employee
```

可以按活动、成员和时间范围进行汇总，但必须保持当前评分算法和历史兼容性。

## 团队整体结果

团队整体结果只来自：

```text
target_type = team
```

**禁止把成员评分平均后冒充团队整体评分。** 这两类数据代表不同评价对象和不同业务语义。

## 趋势

趋势看板支持：

- Employee Trend
- Team Trend
- Date Range
- All Time
- Archived Activities

已归档活动仍应进入历史趋势，因为归档只改变后台主列表状态，不删除历史评分。
