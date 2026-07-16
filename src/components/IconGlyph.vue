<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
</script>

<template>
  <svg class="icon-glyph" :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="name === 'briefcase'">
      <rect x="3" y="7" width="18" height="13" rx="3" fill="currentColor"/><path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" stroke="white" stroke-width="1.8"/><path d="M3 12h18" stroke="white" stroke-width="1.5" opacity=".8"/>
    </template>
    <template v-else-if="name === 'heart'">
      <path d="M12 21S3.5 16.4 3.5 9.5A4.5 4.5 0 0 1 12 7.4a4.5 4.5 0 0 1 8.5 2.1C20.5 16.4 12 21 12 21Z" fill="currentColor"/>
    </template>
    <template v-else-if="name === 'team'">
      <circle cx="9" cy="8" r="4" fill="currentColor"/><circle cx="17" cy="9" r="3" fill="currentColor" opacity=".8"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0H2.5Z" fill="currentColor"/><path d="M14 20a5 5 0 0 1 8 0h-8Z" fill="currentColor" opacity=".8"/>
    </template>
    <template v-else-if="name === 'trophy'">
      <path d="M7 3h10v6a5 5 0 0 1-10 0V3Z" fill="currentColor"/><path d="M7 5H3v2a5 5 0 0 0 5 5M17 5h4v2a5 5 0 0 1-5 5" stroke="currentColor" stroke-width="2"/><path d="M12 14v4M8 21h8M9 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </template>
  </svg>
</template>

<style scoped>.icon-glyph{display:block}</style>
