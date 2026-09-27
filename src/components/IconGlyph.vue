<script setup lang="ts">
import type { Component } from 'vue'
import { Award, Briefcase, Heart, PlusCircle, UserRound, Users } from '@lucide/vue'

defineProps<{ name: string; size?: number }>()

const icons: Record<string, Component> = {
  briefcase: Briefcase,
  heart: Heart,
  team: Users,
  trophy: Award,
  user: UserRound
}
</script>

<template>
  <component :is="icons[name] || PlusCircle" class="icon-glyph" :size="size || 20" aria-hidden="true" />
</template>

<style scoped>.icon-glyph{display:block}</style>
