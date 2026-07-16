<script setup lang="ts">
defineProps<{title:string;description?:string}>()
</script>

<template>
  <section class="admin-page">
    <div class="section-head page-head">
      <div>
        <h1 class="page-title">{{title}}</h1>
        <p v-if="description" class="page-subtitle">{{description}}</p>
      </div>
      <div class="page-actions"><slot name="actions"/></div>
    </div>
    <slot/>
  </section>
</template>

<style scoped>
.admin-page{min-width:0}.page-head{padding:2px 0 4px}.page-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;min-height:38px}@media(max-width:760px){.page-actions{justify-content:flex-start}.page-actions :deep(.el-button),.page-actions :deep(.el-select){width:100%!important}}
</style>
