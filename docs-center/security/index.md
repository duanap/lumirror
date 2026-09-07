---
title: "安全概览"
description: "Lumirror 的敏感信息、邀请码、日志和认证安全边界。"
---

# 安全概览

Lumirror 处理匿名评价、账号认证、邀请码和评分数据，任何架构优化都必须优先保持安全边界。

## 敏感数据

不应写入普通结构化日志：

- 密码
- Authorization
- Cookie
- Session
- 完整邀请码
- 完整时效链接
- 个人评分内容

## 邀请码

邀请码长期存储禁止明文。应使用 hash、fingerprint 和 mask 等不可直接复原的形式，完整邀请码只在生成时返回一次。

## 密码

当前认证继续使用既有 PBKDF2-SHA256、现有 iterations 和 salt，并保持 legacy hash migration。Backend R2 不顺便更换认证算法。

[查看隐私与日志 →](/security/privacy/)
