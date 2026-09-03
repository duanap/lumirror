<script setup lang="ts">
defineProps<{ compact?: boolean; entryMode?: boolean }>()
</script>

<template>
  <main class="public-shell" :class="{ compact }">
    <header v-if="entryMode" class="public-brand entry-brand">
      <p>匿名反馈 · 公平成长</p>
    </header>
    <header v-else class="public-brand">
      <img v-if="!compact" class="brand-mark" src="/favicon.svg" alt="" />
      <div>
        <h1><slot name="title">和光镜鉴</slot></h1>
        <p v-if="!compact">匿名反馈 · 公平成长</p>
      </div>
    </header>
    <section class="public-content"><slot /></section>
  </main>
</template>

<style scoped>
.public-shell{position:relative;min-height:100vh;overflow:hidden;padding:46px 20px 42px;background:linear-gradient(150deg,#fffaf6 0%,#f7f2ec 52%,#fff7ef 100%)}.public-shell.compact{overflow:visible;padding-top:46px;background:linear-gradient(180deg,#fffaf7 0%,#fff 42%,#fff8f2 100%)}.public-shell:before{position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.54) 1px,transparent 1px),linear-gradient(180deg,rgba(255,255,255,.46) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.55),transparent 75%);content:""}.public-shell.compact:before{background:radial-gradient(circle at 4% 3%,rgba(255,177,116,.14) 0 110px,transparent 111px),radial-gradient(circle at 98% 18%,rgba(255,205,165,.16) 0 105px,transparent 106px),radial-gradient(circle at 2% 70%,rgba(255,202,158,.12) 0 92px,transparent 93px);background-size:auto;mask-image:none}.public-content{position:relative;z-index:2;max-width:760px;margin:auto}.public-brand{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:14px;margin:0 auto 34px;color:var(--brand);text-align:left}.entry-brand{margin-bottom:24px}.compact .public-brand{margin-bottom:0;text-align:center}.brand-mark{display:block;width:44px;height:44px;filter:drop-shadow(0 10px 12px rgba(233,91,44,.18))}.public-brand h1{margin:0;color:var(--ink);font-size:clamp(27px,5vw,42px);line-height:1.1;font-weight:850;letter-spacing:0}.compact .public-brand h1{color:#f04b22;font-size:clamp(30px,5vw,42px);letter-spacing:.035em;text-shadow:0 3px 0 rgba(216,58,25,.08)}.public-brand p{margin:7px 0 0;color:#8b6250;font-size:14px;letter-spacing:.08em}.public-brand.entry-brand p{margin:0;color:#8b6250;font-size:14px;font-weight:700;letter-spacing:.12em}
@media(max-width:640px){.public-shell{padding:30px 14px 28px}.public-shell.compact{padding-top:30px;padding-bottom:24px}.public-brand{justify-content:flex-start;max-width:560px;margin-bottom:24px}.entry-brand{justify-content:center;margin-bottom:18px}.compact .public-brand{justify-content:center}.brand-mark{width:38px;height:38px;border-radius:10px}.public-brand h1{font-size:26px}.compact .public-brand h1{font-size:27px}.public-brand p{font-size:12px}.entry-brand p{font-size:12px}}
</style>
