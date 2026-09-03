<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AdminPage from '../../components/AdminPage.vue'
import TrendLineChart, { type TrendPoint } from '../../components/TrendLineChart.vue'
import { api, unwrap } from '../../lib/api'

const targetType = ref<'employee'|'team'>('employee')
const targetId = ref('')
const dateRange = ref<[Date,Date] | null>(null)
const options = ref<any>({employees:[],teams:[]})
const data = ref<{target:any;points:TrendPoint[]}>({target:null,points:[]})
const loading = ref(false)
const targets = computed(() => targetType.value === 'team' ? options.value.teams : options.value.employees)
const totalDelta = computed(() => {
  const points = data.value.points
  if (points.length < 2) return null
  return Math.round((points.at(-1)!.total-points[0].total)*10)/10
})

function query() {
  const params = new URLSearchParams({targetType:targetType.value,targetId:targetId.value})
  if (dateRange.value) {
    params.set('startTime',dateRange.value[0].toISOString())
    const endDate = new Date(dateRange.value[1])
    endDate.setHours(23,59,59,999)
    params.set('endTime',endDate.toISOString())
  }
  return params.toString()
}
async function loadOptions() {
  options.value = unwrap(await api.get('/admin/trends/options'))
  if (!targetId.value || !targets.value.some((target:any) => target.id === targetId.value)) targetId.value = targets.value[0]?.id || ''
}
async function loadTrend() {
  if (!targetId.value) { data.value = {target:null,points:[]}; return }
  loading.value = true
  try { data.value = unwrap(await api.get(`/admin/trends?${query()}`)) }
  finally { loading.value = false }
}
function resetDates() { dateRange.value = null; void loadTrend() }
watch(targetType,async () => { targetId.value = ''; await loadOptions(); await loadTrend() })
watch(targetId,() => { void loadTrend() })
onMounted(async () => { await loadOptions(); await loadTrend() })
</script>

<template>
  <AdminPage title="趋势看板" description="按评价活动查看员工或团队整体评分的变化；团队趋势仅统计团队整体评价，不会混入成员平均分。">
    <div class="filters panel">
      <el-radio-group v-model="targetType"><el-radio-button value="employee">员工趋势</el-radio-button><el-radio-button value="team">团队趋势</el-radio-button></el-radio-group>
      <el-select v-model="targetId" filterable placeholder="选择对象"><el-option v-for="target in targets" :key="target.id" :label="targetType==='team'?`${target.name} · ${target.departmentName||'未设置部门'}`:`${target.name} · ${target.teamName||'未设置团队'}`" :value="target.id"/></el-select>
      <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @change="loadTrend"/>
      <el-button @click="resetDates">全部时间</el-button><el-button @click="loadTrend">刷新</el-button>
    </div>
    <section v-loading="loading" class="panel trend-panel">
      <header v-if="data.target" class="trend-head"><div><p>{{targetType==='team'?'团队整体评分趋势':'员工综合评分趋势'}}</p><h2>{{data.target.name}}</h2><small>{{data.target.departmentName}}{{data.target.teamName ? ` · ${data.target.teamName}` : ''}}</small></div><div class="trend-summary"><span>活动数 <b>{{data.points.length}}</b></span><span>变化 <b :class="{positive:totalDelta!==null&&totalDelta>0,negative:totalDelta!==null&&totalDelta<0}">{{totalDelta===null?'--':`${totalDelta>0?'+':''}${totalDelta}`}}</b></span></div></header>
      <TrendLineChart :points="data.points"/>
    </section>
    <section class="panel table-wrap history-table"><el-table :data="data.points"><el-table-column prop="activityName" label="评价活动" min-width="200"/><el-table-column prop="periodName" label="评价周期" min-width="150"/><el-table-column prop="evaluationTime" label="评价时间" min-width="180"/><el-table-column prop="reviewCount" label="有效评价" width="100"/><el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.archived?'info':'success'">{{row.archived?'已归档':'活动记录'}}</el-tag></template></el-table-column><el-table-column prop="total" label="综合平均分" width="120"><template #default="{row}"><b class="total">{{row.total}}</b></template></el-table-column></el-table></section>
  </AdminPage>
</template>

<style scoped>
.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:22px 0 16px;padding:14px}.filters .el-select{width:260px}.trend-panel{padding:20px}.trend-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:16px}.trend-head p,.trend-head small{margin:0;color:var(--muted)}.trend-head h2{margin:4px 0;font-size:25px}.trend-summary{display:flex;gap:10px}.trend-summary span{display:grid;gap:3px;padding:9px 13px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:12px}.trend-summary b{color:var(--brand);font-size:19px}.trend-summary b.positive{color:var(--success)}.trend-summary b.negative{color:#b24b42}.history-table{margin-top:16px}.total{color:var(--brand);font-size:17px}@media(max-width:760px){.filters{align-items:stretch;flex-direction:column}.filters .el-select,.filters .el-date-editor{width:100%!important}.trend-head{align-items:flex-start;flex-direction:column}.trend-summary{width:100%}.trend-summary span{flex:1}.trend-panel{padding:14px}}
</style>
