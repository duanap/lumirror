<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Plus } from '@element-plus/icons-vue'
import AdminPage from '../../components/AdminPage.vue'
import ColumnSettings from '../../components/ColumnSettings.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'
import { useColumnSettings } from '../../lib/columns'

const rows = ref<any[]>([])
const route = useRoute()
const activities = ref<any[]>([])
const employees = ref<any[]>([])
const selected = ref('')
const dialog = ref(false)
const generated = ref<any[]>([])
const loading = ref(false)
const canWrite = ref(false)
const selectedRows = ref<any[]>([])
const form = reactive({ evaluationCodeId:'', mode:'quantity', count:5, participantEmployeeIds:[] as string[] })

const selectedActivity = computed(() => activities.value.find((x) => x.id === form.evaluationCodeId))
const selectedCount = computed(() => selectedRows.value.length)
const verifyColumns = [
  { key:'participant', label:'绑定成员' },
  { key:'activity', label:'评价活动' },
  { key:'team', label:'所属团队' },
  { key:'expected', label:'应评' },
  { key:'submitted', label:'已评' },
  { key:'remaining', label:'剩余' },
  { key:'status', label:'状态' }
]
const columns = useColumnSettings('lumirror.admin.verify-codes.columns', verifyColumns)
const visibleColumns = columns.selected
const selectableColumns = columns.selectable

async function load() {
  try {
    if (!selected.value && route.query.evaluationCodeId) selected.value = String(route.query.evaluationCodeId)
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/verify-codes${query}`))
    rows.value = data.items
    activities.value = data.activities
    canWrite.value = Boolean(data.canWrite)
    if (!selected.value && activities.value.length) selected.value = activities.value[0].id
    if (!form.evaluationCodeId && activities.value.length) form.evaluationCodeId = activities.value[0].id
    const optionData = unwrap<any>(await api.get('/admin/evaluation-options'))
    employees.value = optionData.employees
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
}
function openGenerate() {
  Object.assign(form,{evaluationCodeId:selected.value||activities.value[0]?.id||'',mode:'quantity',count:5,participantEmployeeIds:[]})
  generated.value = []
  dialog.value = true
}
async function generate() {
  if (!form.evaluationCodeId) return ElMessage.warning('请选择评价活动')
  if (form.mode === 'selected' && !form.participantEmployeeIds.length) return ElMessage.warning('请选择成员')
  loading.value = true
  try {
    const data = unwrap<any>(await api.post('/admin/verify-codes/generate',{
      evaluationCodeId:form.evaluationCodeId,
      count:form.mode==='quantity'?form.count:0,
      participantEmployeeIds:form.mode==='selected'?form.participantEmployeeIds:[]
    }))
    generated.value = data.codes
    ElMessage.success(`已生成 ${data.codes.length} 个邀请码，并建立 ${data.taskCount} 个评价任务`)
    selected.value = form.evaluationCodeId
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '生成失败') }
  finally { loading.value = false }
}
function download() {
  const activity = selectedActivity.value
  const lines = generated.value.map((x:any) => x.code)
  const blob = new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'})
  const a = document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${activity?.name||'评价活动'}-补充邀请码.txt`;a.click();URL.revokeObjectURL(a.href)
}
async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除邀请码“${row.code}”？已提交过评价的邀请码无法删除。`,'删除邀请码',{type:'warning'})
    await api.delete(`/admin/verify-codes/${row.id}`)
    ElMessage.success('邀请码已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:any[]) { selectedRows.value = rows }
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 个邀请码？已提交过评价的邀请码会被系统阻止删除。`,'批量删除邀请码',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('verify-codes','delete',selectedRows.value,'已批量删除',(row) => row.code)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
onMounted(load)
</script>

<template>
  <AdminPage title="邀请码" description="每个 6 位数字邀请码匿名唯一；可绑定具体成员，也可按数量生成未绑定邀请码">
    <template #actions><el-button v-if="canWrite" type="primary" :icon="Plus" @click="openGenerate">补充生成邀请码</el-button></template>
    <el-alert title="后台正常显示邀请码；旧数据如果历史上只保存过哈希，则无法反推完整邀请码。删除仅限未提交过评价的邀请码。" type="warning" :closable="false" show-icon class="notice"/>
    <div v-if="canWrite && selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="toolbar filter-toolbar">
      <el-select v-model="selected" placeholder="筛选评价活动" clearable style="width:360px" @change="load"><el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/></el-select>
      <el-button @click="load">刷新</el-button>
      <ColumnSettings v-model="visibleColumns" :options="selectableColumns" @reset="columns.reset"/>
    </div>
    <div class="panel table-wrap">
      <el-table :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column prop="code" label="邀请码" width="125"><template #default="{row}"><b class="code">{{row.code}}</b></template></el-table-column>
        <el-table-column v-if="columns.visible('participant')" prop="participantName" label="绑定成员" min-width="120"/>
        <el-table-column v-if="columns.visible('activity')" prop="activityName" label="评价活动" min-width="190"/>
        <el-table-column v-if="columns.visible('team')" prop="teamName" label="所属团队" min-width="110"/>
        <el-table-column v-if="columns.visible('expected')" prop="expected" label="应评" width="70"/>
        <el-table-column v-if="columns.visible('submitted')" prop="submitted" label="已评" width="70"/>
        <el-table-column v-if="columns.visible('remaining')" prop="remaining" label="剩余" width="70"/>
        <el-table-column v-if="columns.visible('status')" label="状态" width="95"><template #default="{row}"><el-tag :type="row.status==='completed'?'success':row.status==='in_progress'?'warning':'info'">{{row.statusLabel}}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="90" fixed="right"><template #default="{row}"><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" title="补充生成邀请码" width="min(680px,94vw)" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="评价活动"><el-select v-model="form.evaluationCodeId" style="width:100%"><el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/></el-select></el-form-item>
        <el-form-item label="生成方式"><el-radio-group v-model="form.mode"><el-radio-button value="quantity">指定数量</el-radio-button><el-radio-button value="selected">绑定成员</el-radio-button></el-radio-group></el-form-item>
        <el-form-item v-if="form.mode==='quantity'" label="新增数量"><el-input-number v-model="form.count" :min="1" :max="100"/><span class="hint">数量不与团队成员总数绑定。</span></el-form-item>
        <el-form-item v-else label="选择成员"><el-select v-model="form.participantEmployeeIds" multiple filterable style="width:100%"><el-option v-for="x in employees.filter((e:any)=>e.teamId===selectedActivity?.teamId)" :key="x.id" :label="`${x.name} · ${x.position}`" :value="x.id"/></el-select></el-form-item>
      </el-form>
      <div v-if="generated.length" class="generated">
        <div class="generated-head"><b>本次生成结果</b><el-button :icon="Download" @click="download">下载完整邀请码</el-button></div>
        <div class="code-grid"><code v-for="x in generated" :key="x.code"><small v-if="x.employeeName">{{x.employeeName}}</small>{{x.code}}</code></div>
      </div>
      <template #footer><el-button @click="dialog=false">关闭</el-button><el-button type="primary" :loading="loading" @click="generate">生成并建立任务</el-button></template>
    </el-dialog>
  </AdminPage>
</template>

<style scoped>
.notice{margin:20px 0 16px}.batch-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}.filter-toolbar{justify-content:flex-start}.code{color:var(--brand);letter-spacing:.08em}.hint{display:block;margin-left:12px;color:var(--muted);font-size:13px}.generated{margin-top:16px;padding:15px;border-radius:10px;background:var(--surface-tint)}.generated-head{display:flex;align-items:center;justify-content:space-between}.code-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;max-height:190px;overflow:auto}.code-grid code{display:grid;gap:3px;padding:9px;border-radius:6px;background:var(--surface);color:var(--brand);text-align:center;font-weight:700}.code-grid small{color:var(--muted);font-weight:500}@media(max-width:600px){.filter-toolbar{align-items:stretch;flex-direction:column}.filter-toolbar .el-select{width:100%!important}.code-grid{grid-template-columns:1fr 1fr}}
</style>
