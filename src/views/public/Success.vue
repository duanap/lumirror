<script setup lang="ts">
import { CircleCheckFilled } from '@element-plus/icons-vue'
import PublicShell from '../../layouts/PublicShell.vue'
</script>

<template>
  <PublicShell>
    <template #title>和光镜鉴</template>
    <section class="success-card">
      <CircleCheckFilled class="icon"/>
      <span class="eyebrow">提交成功</span>
      <h2>全部评价已完成</h2>
      <p>感谢您的认真参与。所有评分都会以匿名方式汇总统计，提交后不会展示个人评分结果。</p>
      <div class="notice">您的邀请码已自动锁定，无需再次操作。</div>
      <a href="/">返回首页</a>
    </section>
  </PublicShell>
</template>

<style scoped>
.success-card{max-width:560px;margin:36px auto 0;padding:52px 44px 40px;border:1px solid rgba(23,138,82,.18);border-radius:18px;background:rgba(255,255,255,.97);box-shadow:var(--shadow);text-align:center}.icon{width:76px;color:var(--success)}.eyebrow{display:block;margin-top:14px;color:var(--success);font-size:13px;font-weight:800}h2{margin:8px 0 10px;color:var(--ink);font-size:28px}p{margin:0;color:var(--muted);line-height:1.8}.notice{margin:26px 0;padding:14px;border:1px solid #d9ebdf;border-radius:12px;color:#315d43;background:#f4fbf6}a{display:inline-flex;align-items:center;justify-content:center;width:190px;height:48px;border-radius:999px;color:#fff;background:linear-gradient(100deg,var(--brand),var(--brand-2));font-weight:760}@media(max-width:600px){.success-card{padding:42px 22px 32px;margin-top:24px}}
</style>
