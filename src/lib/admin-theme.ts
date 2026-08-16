import { computed, ref } from 'vue'
import type { Router } from 'vue-router'

export type AdminThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedAdminTheme = 'light' | 'dark'

const STORAGE_KEY = 'lumirror.admin.theme'
const stored = typeof localStorage === 'undefined' ? '' : localStorage.getItem(STORAGE_KEY)

export const adminThemeMode = ref<AdminThemeMode>(stored === 'light' || stored === 'dark' ? stored : 'auto')
export const resolvedAdminTheme = ref<ResolvedAdminTheme>('light')
export const adminThemeLabel = computed(() => ({auto:'自动',light:'浅色',dark:'深色'}[adminThemeMode.value]))

function automaticTheme(date = new Date()): ResolvedAdminTheme {
  const hour = date.getHours()
  return hour >= 19 || hour < 8 ? 'dark' : 'light'
}

export function applyAdminTheme(path = window.location.pathname, date = new Date()) {
  resolvedAdminTheme.value = adminThemeMode.value === 'auto' ? automaticTheme(date) : adminThemeMode.value
  if (path.startsWith('/admin')) {
    document.documentElement.dataset.adminTheme = resolvedAdminTheme.value
    document.documentElement.style.colorScheme = resolvedAdminTheme.value
  } else {
    delete document.documentElement.dataset.adminTheme
    document.documentElement.style.removeProperty('color-scheme')
  }
}

export function setAdminThemeMode(mode: AdminThemeMode) {
  adminThemeMode.value = mode
  if (mode === 'auto') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY,mode)
  applyAdminTheme()
}

export function initializeAdminTheme(router: Router) {
  applyAdminTheme(router.currentRoute.value.path)
  router.afterEach((to) => applyAdminTheme(to.path))
  window.setInterval(() => {
    if (adminThemeMode.value === 'auto') applyAdminTheme(router.currentRoute.value.path)
  },60_000)
}
