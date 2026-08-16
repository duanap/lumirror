<script setup lang="ts">
import { computed } from 'vue'
import { avatarPresetById, avatarSpriteStyle } from '../lib/avatars'

const props = withDefaults(defineProps<{
  avatar?: string
  gender?: 'male' | 'female' | 'unknown'
  size?: number
  alt?: string
}>(), { gender:'unknown', size:48, alt:'成员头像' })

const preset = computed(() => avatarPresetById(props.avatar))
const fallback = computed(() => `/assets/avatar/default-${props.gender === 'female' ? 'female' : 'male'}.svg`)
const spriteStyle = computed(() => preset.value ? {
  width: `${props.size}px`,
  height: `${props.size}px`,
  ...avatarSpriteStyle(preset.value, props.size)
} : undefined)
</script>

<template>
  <span v-if="preset" class="employee-avatar" :style="spriteStyle" role="img" :aria-label="alt"/>
  <img v-else class="employee-avatar" :src="avatar || fallback" :alt="alt" :style="{width:`${size}px`,height:`${size}px`}"/>
</template>

<style scoped>
.employee-avatar{display:block;flex:0 0 auto;border-radius:50%;background-color:var(--surface-tint);background-repeat:no-repeat;object-fit:cover}
</style>
