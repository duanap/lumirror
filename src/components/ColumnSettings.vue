<script setup lang="ts">
import { Setting } from '@element-plus/icons-vue'
import type { ColumnOption } from '../lib/columns'

defineProps<{
  options: ColumnOption[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  reset: []
}>()

function updateValue(value: string[]) {
  emit('update:modelValue', value)
}
</script>

<template>
  <el-popover placement="bottom-end" width="220" trigger="click">
    <template #reference>
      <el-button :icon="Setting">显示字段</el-button>
    </template>
    <div class="column-settings">
      <div class="settings-head"><b>表格字段</b><el-button link type="primary" @click="emit('reset')">恢复默认</el-button></div>
      <el-checkbox-group :model-value="modelValue" @update:model-value="updateValue">
        <el-checkbox v-for="item in options" :key="item.key" :label="item.key">{{ item.label }}</el-checkbox>
      </el-checkbox-group>
    </div>
  </el-popover>
</template>

<style scoped>
.column-settings{display:grid;gap:10px}.settings-head{display:flex;align-items:center;justify-content:space-between}.column-settings :deep(.el-checkbox-group){display:grid;gap:6px}.column-settings :deep(.el-checkbox){height:26px;margin-right:0}
</style>
