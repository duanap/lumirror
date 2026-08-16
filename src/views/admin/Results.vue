<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'
import type { ScoreRule } from '../../types'

const rows = ref<any[]>([])
const activities = ref<any[]>([])
const rules = ref<ScoreRule[]>([])
const selected = ref('')
const loading = ref(false)
const enabledRules = computed(() => rules.value.filter((rule) => rule.enabled))

async function load() {
  loading.value = true
  try {
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/results${query}`))
    rows.value = data.items
    activities.value = data.activities
    rules.value = data.rules || []
    if (data.activity?.id) selected.value = data.activity.id
  } finally { loading.value = false }
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char))
}
function exportExcel() {
  const activity = activities.value.find((x) => x.id === selected.value)
  const headers = ['排名','员工姓名','性别','团队','岗位','收到评价人数',...enabledRules.value.map((rule) => `${rule.name}${rule.operation === 'subtract' ? '（减少）' : ''}平均分`),'综合平均分']
  const body = rows.value.map((row) => [row.rank,row.name,row.genderLabel,row.teamName,row.position,row.reviewCount,...enabledRules.value.map((rule) => row.values?.[rule.id] ?? '--'),row.total])
  const table = `<table border="1"><thead><tr>${headers.map((x) => `<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((x) => `<td>${escapeHtml(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body>${table}</body></html>`
  const blob = new Blob(['\ufeff', html], { type:'application/vnd.ms-excel;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${activity?.name || 'Lumirror'}-评分结果.xls`; a.click(); URL.revokeObjectURL(a.href)
}
onMounted(load)
</script>

<template>
  <AdminPage title="评分结果" description="按评价活动独立汇总，避免不同团队和不同活动的数据混在一起">
    <template #actions><el-button @click="exportExcel" :disabled="!rows.length">导出 Excel</el-button></template>
    <div class="filters">
      <el-select v-model="selected" placeholder="选择评价活动" style="width:360px" @change="load">
        <el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/>
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table v-loading="loading" :data="rows">
        <el-table-column prop="rank" label="排名" width="75"/>
        <el-table-column prop="name" label="员工姓名"/>
        <el-table-column prop="genderLabel" label="性别" width="75"/>
        <el-table-column prop="teamName" label="团队"/>
        <el-table-column prop="position" label="岗位"/>
        <el-table-column prop="reviewCount" label="评价人数" width="90"/>
        <el-table-column v-for="rule in enabledRules" :key="rule.id" :label="`${rule.name}${rule.operation==='subtract'?'（减）':''}`" min-width="110"><template #default="{row}">{{row.values?.[rule.id]??'--'}}</template></el-table-column>
        <el-table-column label="综合平均分" width="110"><template #default="{ row }"><b class="total">{{ row.total }}</b></template></el-table-column>
      </el-table>
    </div>
  </AdminPage>
</template>
<style scoped>.filters{display:flex;gap:10px;margin:22px 0 16px}.total{color:var(--brand);font-size:17px}@media(max-width:600px){.filters{flex-direction:column}.filters .el-select{width:100%!important}}</style>
