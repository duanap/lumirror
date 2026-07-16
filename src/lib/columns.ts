import { computed, ref, watch } from 'vue'

export interface ColumnOption {
  key: string
  label: string
  fixed?: boolean
  defaultVisible?: boolean
}

export function useColumnSettings(storageKey: string, options: ColumnOption[]) {
  const defaultKeys = options
    .filter((option) => option.fixed || option.defaultVisible !== false)
    .map((option) => option.key)
  const selected = ref<string[]>([...defaultKeys])

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (Array.isArray(saved)) {
      const allowed = new Set(options.map((option) => option.key))
      selected.value = saved.filter((key) => allowed.has(key))
      for (const option of options) if (option.fixed && !selected.value.includes(option.key)) selected.value.push(option.key)
    }
  } catch {
    selected.value = [...defaultKeys]
  }

  watch(selected, (value) => localStorage.setItem(storageKey, JSON.stringify(value)), { deep: true })

  const selectable = computed(() => options.filter((option) => !option.fixed))
  function visible(key: string) {
    return selected.value.includes(key)
  }
  function reset() {
    selected.value = [...defaultKeys]
  }

  return { selected, selectable, visible, reset }
}
