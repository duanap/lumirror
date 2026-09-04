<script setup lang="ts">
import { computed } from 'vue'
import { avatarPresetById } from '../lib/avatars'

const props = withDefaults(defineProps<{
  avatar?: string
  gender?: 'male' | 'female' | 'unknown'
  size?: number
  alt?: string
  thumbnail?: boolean
  loading?: 'eager' | 'lazy'
}>(), { gender:'unknown', size:48, alt:'成员头像', thumbnail:false, loading:'eager' })

const preset = computed(() => avatarPresetById(props.avatar))
const source = computed(() => props.thumbnail ? preset.value?.thumbSrc : preset.value?.src)
</script>

<template>
  <img v-if="preset" class="employee-avatar" :src="source" :alt="alt" :style="{width:`${size}px`,height:`${size}px`}" :loading="loading" decoding="async" :fetchpriority="loading==='eager'?'high':'auto'"/>
  <span v-else class="employee-avatar employee-avatar--empty" :style="{width:`${size}px`,height:`${size}px`}" role="img" :aria-label="alt"/>
</template>

<style scoped>
.employee-avatar{display:block;flex:0 0 auto;border-radius:50%;object-fit:cover}
.employee-avatar--empty{border:1px solid var(--line);background:var(--surface-tint)}
</style>
