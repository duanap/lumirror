<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <main class="public-shell" :class="{ compact }">
    <header class="public-brand">
      <span class="brand-mark">L</span>
      <div>
        <h1><slot name="title">和光镜鉴</slot></h1>
        <p>匿名反馈 · 公平成长</p>
      </div>
    </header>
    <section class="public-content"><slot /></section>
  </main>
</template>

<style scoped>
.public-shell{position:relative;min-height:100vh;overflow:hidden;padding:46px 20px 42px;background:linear-gradient(150deg,#fffaf6 0%,#f7f2ec 52%,#fff7ef 100%)}.public-shell.compact{overflow:visible;padding-top:22px}.public-shell:before{position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.54) 1px,transparent 1px),linear-gradient(180deg,rgba(255,255,255,.46) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.55),transparent 75%);content:""}.public-content{position:relative;z-index:2;max-width:760px;margin:auto}.public-brand{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:14px;margin:0 auto 34px;color:var(--brand);text-align:left}.compact .public-brand{gap:11px;margin-bottom:20px}.brand-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 10px 24px rgba(233,91,44,.18);font-size:21px;font-weight:850}.compact .brand-mark{width:38px;height:38px;border-radius:10px;font-size:18px}.public-brand h1{margin:0;color:var(--ink);font-size:clamp(27px,5vw,42px);line-height:1.1;font-weight:850;letter-spacing:0}.compact .public-brand h1{font-size:clamp(24px,4vw,32px)}.public-brand p{margin:7px 0 0;color:#8b6250;font-size:14px;letter-spacing:.08em}.compact .public-brand p{margin-top:4px;font-size:12px}
@media(max-width:640px){.public-shell{padding:30px 14px 28px}.public-shell.compact{padding-top:16px;padding-bottom:18px}.public-brand{justify-content:flex-start;max-width:560px;margin-bottom:24px}.compact .public-brand{margin-bottom:14px}.brand-mark{width:38px;height:38px;border-radius:10px}.compact .brand-mark{width:34px;height:34px}.public-brand h1{font-size:26px}.compact .public-brand h1{font-size:22px}.public-brand p{font-size:12px}.compact .public-brand p{font-size:11px}}
</style>
