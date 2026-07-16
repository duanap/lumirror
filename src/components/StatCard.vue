<script setup lang="ts">
defineProps<{label:string;value:string|number;hint?:string;color?:string}>()
</script>

<template>
  <div class="stat-card">
    <span>{{label}}</span>
    <strong :style="{color:color||'var(--ink)'}">{{value}}</strong>
    <small v-if="hint">{{hint}}</small>
  </div>
</template>

<style scoped>
.stat-card{position:relative;min-height:126px;padding:20px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,#fff,#fffaf6);box-shadow:var(--shadow-soft);overflow:hidden}.stat-card:after{position:absolute;right:-24px;top:-26px;width:76px;height:76px;border-radius:50%;background:#fff0e7;content:""}span{position:relative;color:var(--muted);font-size:13px;font-weight:700}strong{position:relative;display:block;margin:14px 0 7px;font-size:31px;line-height:1;font-weight:820}small{position:relative;color:var(--subtle);word-break:break-all}
</style>
