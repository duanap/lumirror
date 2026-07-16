<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'

const rows = ref<any[]>([])
const activities = ref<any[]>([])
const selected = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/results${query}`))
    rows.value = data.items
    activities.value = data.activities
    if (data.activity?.id) selected.value = data.activity.id
  } finally { loading.value = false }
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char))
}
function exportExcel() {
  const activity = activities.value.find((x) => x.id === selected.value)
  const headers = ['排名','员工姓名','性别','团队','岗位','收到评价人数','工作能力平均分','工作态度平均分','协作能力平均分','综合平均分']
  const body = rows.value.map((r) => [r.rank,r.name,r.genderLabel,r.teamName,r.position,r.reviewCount,r.ability,r.attitude,r.collaboration,r.total])
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
        <el-table-column prop="ability" label="工作能力" width="95"/>
        <el-table-column prop="attitude" label="工作态度" width="95"/>
        <el-table-column prop="collaboration" label="协作能力" width="95"/>
        <el-table-column label="综合平均分" width="110"><template #default="{ row }"><b class="total">{{ row.total }}</b></template></el-table-column>
      </el-table>
    </div>
  </AdminPage>
</template>
<style scoped>.filters{display:flex;gap:10px;margin:22px 0 16px}.total{color:var(--brand);font-size:17px}@media(max-width:600px){.filters{flex-direction:column}.filters .el-select{width:100%!important}}</style>
