<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Download, Plus, Delete } from '@element-plus/icons-vue'
import AdminPage from '../../components/AdminPage.vue'
import ColumnSettings from '../../components/ColumnSettings.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'
import { useColumnSettings } from '../../lib/columns'

const rows = ref<any[]>([])
const router = useRouter()
const teams = ref<any[]>([])
const periods = ref<any[]>([])
const employees = ref<any[]>([])
const canWrite = ref(false)
const dialog = ref(false)
const step = ref(0)
const creating = ref(false)
const result = ref<any>(null)
const selectedRows = ref<any[]>([])
const form = reactive<any>({
  name:'',teamId:'',participantMode:'selected',participantEmployeeIds:[],participantCount:5,
  targetType:'employee',targetMode:'all',targetEmployeeIds:[],targetTeamIds:[],excludeSelf:true,periodId:'',periodName:'',
  periodMode:'new',
  startTime:new Date(),endTime:new Date(Date.now()+30*24*60*60*1000),rounding:'one_decimal'
})

const selectedTeam = computed(() => teams.value.find((x) => x.id === form.teamId))
const teamEmployees = computed(() => employees.value.filter((x) => x.teamId === form.teamId && x.status === 'active'))
const participantCount = computed(() => form.participantMode === 'selected' ? form.participantEmployeeIds.length : Number(form.participantCount || 0))
const targetCount = computed(() => {
  if (form.targetType === 'team') return form.targetMode === 'selected' ? form.targetTeamIds.length : teams.value.length
  return form.targetMode === 'selected' ? form.targetEmployeeIds.length : teamEmployees.value.length
})
const selectedCount = computed(() => selectedRows.value.length)
const selectedPeriod = computed(() => periods.value.find((period) => period.id === form.periodId))
const periodLabel = computed(() => form.periodMode === 'existing' ? selectedPeriod.value?.name || '未选择' : form.periodName || `${form.name || '新评价活动'}周期`)
const activityColumns = [
  { key:'link', label:'邀请链接' },
  { key:'period', label:'评价周期' },
  { key:'team', label:'参与团队' },
  { key:'participants', label:'邀请码数' },
  { key:'targets', label:'评价对象' },
  { key:'tasks', label:'任务总数' },
  { key:'completion', label:'完成率' },
  { key:'status', label:'状态' }
]
const columns = useColumnSettings('lumirror.admin.activities.columns.v2', activityColumns)
const visibleColumns = columns.selected
const selectableColumns = columns.selectable
const estimatedTaskCount = computed(() => {
  if (form.targetType === 'team' || form.participantMode !== 'selected' || !form.excludeSelf) return participantCount.value * targetCount.value
  const targetSet = new Set(form.targetMode === 'selected' ? form.targetEmployeeIds : teamEmployees.value.map((x:any) => x.id))
  const selfExcluded = form.participantEmployeeIds.filter((id:string) => targetSet.has(id)).length
  return participantCount.value * targetCount.value - selfExcluded
})

async function load() {
  try {
    const [activityRes,optionRes] = await Promise.all([api.get('/admin/evaluation-codes'),api.get('/admin/evaluation-options')])
    const activityData = unwrap<any>(activityRes)
    rows.value = activityData.items
    canWrite.value = Boolean(activityData.canWrite)
    const options = unwrap<any>(optionRes)
    teams.value = options.teams
    periods.value = options.periods
    employees.value = options.employees
    if (!form.teamId) form.teamId = teams.value[0]?.id || ''
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
}
function resetSelections() {
  form.participantEmployeeIds = []
  form.targetEmployeeIds = []
  form.targetTeamIds = []
}
function openCreate() {
  const firstTeam = teams.value[0]?.id || ''
  Object.assign(form,{
    name:'',teamId:firstTeam,participantMode:'selected',participantEmployeeIds:[],participantCount:5,
    targetType:'employee',targetMode:'all',targetEmployeeIds:[],targetTeamIds:[],excludeSelf:true,periodId:'',periodName:'',
    periodMode:'new',
    startTime:new Date(),endTime:new Date(Date.now()+30*24*60*60*1000),rounding:'one_decimal'
  })
  result.value = null
  step.value = 0
  dialog.value = true
}
function selectAllParticipants() { form.participantEmployeeIds = teamEmployees.value.map((x:any) => x.id) }
function selectAllTargets() {
  if (form.targetType === 'team') form.targetTeamIds = teams.value.map((x:any) => x.id)
  else form.targetEmployeeIds = teamEmployees.value.map((x:any) => x.id)
}
function next() {
  if (!form.name.trim()) return ElMessage.warning('请输入评价活动名称')
  if (!form.teamId) return ElMessage.warning('请选择评价团队')
  if (form.participantMode === 'selected' && !form.participantEmployeeIds.length) return ElMessage.warning('请选择至少 1 名参与评价成员')
  if (form.participantMode === 'quantity' && (!Number.isInteger(form.participantCount) || form.participantCount < 1 || form.participantCount > 200)) return ElMessage.warning('邀请码数量必须为 1-200 的整数')
  if (form.targetMode === 'selected' && !(form.targetType === 'team' ? form.targetTeamIds : form.targetEmployeeIds).length) return ElMessage.warning('请选择至少 1 个评价对象')
  if (form.periodMode === 'existing' && !selectedPeriod.value) return ElMessage.warning('请选择评价周期')
  if (form.periodMode === 'new' && !form.periodName.trim()) return ElMessage.warning('请输入新评价周期名称')
  if (!form.startTime || !form.endTime || new Date(form.startTime) >= new Date(form.endTime)) return ElMessage.warning('请设置正确的开始和结束时间')
  if (form.periodMode === 'existing' && selectedPeriod.value && (new Date(form.startTime) < new Date(selectedPeriod.value.startTime) || new Date(form.endTime) > new Date(selectedPeriod.value.endTime))) return ElMessage.warning('评价活动时间必须处于所选周期时间范围内')
  if (estimatedTaskCount.value <= 0) return ElMessage.warning('当前设置不会生成任何评价任务，请调整参与成员或评价对象')
  step.value = 1
}
async function createFlow() {
  creating.value = true
  try {
    result.value = unwrap<any>(await api.post('/admin/evaluation-activities/create-flow',{
      ...form,periodId:form.periodMode === 'existing' ? form.periodId : '',startTime:new Date(form.startTime).toISOString(),endTime:new Date(form.endTime).toISOString()
    }))
    step.value = 2
    await load()
    ElMessage.success('评价活动、邀请码和评价任务已生成')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '创建失败') }
  finally { creating.value = false }
}
async function copy(value:string,label='内容') {
  await navigator.clipboard.writeText(value)
  ElMessage.success(`${label}已复制`)
}
function inviteLink(code:string) {
  return `${window.location.origin}/i/${code}`
}
function timedLink(code:string) {
  return `${window.location.origin}/t/${code}`
}
function downloadCodes() {
  if (!result.value) return
  const lines = result.value.verifyCodes.map((item:any) => item.code)
  const blob = new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'})
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${result.value.activity.name}-邀请码.txt`
  a.click(); URL.revokeObjectURL(a.href)
}

async function toggleStatus(row:any) {
  const next = row.status === 'disabled' ? 'active' : 'disabled'
  try {
    await api.put(`/admin/evaluation-codes/${row.id}`,{status:next})
    ElMessage.success(next === 'disabled' ? '评价活动已停用' : '评价活动已启用')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '操作失败') }
}

function onSelectionChange(rows:any[]) { selectedRows.value = rows }

async function batchStatus(status:string) {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认将选中的 ${selectedRows.value.length} 个评价活动改为“${statusText(status)}”？`,'批量修改状态',{type:'warning'})
    await runBatchAction('evaluation-codes','status',selectedRows.value,'批量状态已更新',(row) => row.name,{status})
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量操作失败')
  }
}

async function createTimedLink(row:any) {
  try {
    const data = unwrap<any>(await api.post('/admin/timed-invites/generate',{evaluationCodeId:row.id}))
    await copy(timedLink(data.linkCode),'时效链接')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '生成失败') }
}

async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除评价活动“${row.name}”？将同步删除相关待评价任务、邀请码、时效链接和评分数据。`,'删除评价活动',{type:'warning',confirmButtonText:'确认删除'})
    await api.delete(`/admin/evaluation-codes/${row.id}`)
    ElMessage.success('评价活动已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 个评价活动？将同步删除相关待评价任务、邀请码、时效链接和评分数据。`,'批量删除评价活动',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('evaluation-codes','delete',selectedRows.value,'已批量删除',(row) => row.name)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
function manageVerify(row:any) { router.push(`/admin/verify-codes?evaluationCodeId=${encodeURIComponent(row.id)}`) }
function manageTasks(row:any) { router.push(`/admin/tasks?evaluationCodeId=${encodeURIComponent(row.id)}`) }
function statusText(status:string) { return ({active:'进行中',upcoming:'未开始',ended:'已结束',disabled:'已停用',archived:'已归档'} as any)[status] || status }
function statusType(status:string) { return status==='active'?'success':status==='upcoming'?'warning':status==='ended'?'info':'danger' }
watch(() => form.teamId,resetSelections)
watch(() => form.targetType,() => {
  form.targetEmployeeIds = []
  form.targetTeamIds = []
  if (form.targetType === 'team') form.excludeSelf = false
})
onMounted(load)
</script>

<template>
  <AdminPage title="评价活动" description="按流程一次完成活动、邀请链接、邀请码和评价任务创建；参与人数与团队成员总数相互独立">
    <template #actions><el-button v-if="canWrite" type="primary" :icon="Plus" @click="openCreate">创建评价活动</el-button></template>
    <el-alert class="flow-tip" type="success" :closable="false" show-icon title="推荐按成员名单生成：每位成员自动绑定唯一 6 位数字邀请码；也可生成一次性时效链接，打开后 5 分钟内有效。"/>
    <div class="toolbar field-toolbar"><ColumnSettings v-model="visibleColumns" :options="selectableColumns" @reset="columns.reset"/></div>
    <div v-if="canWrite && selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" @click="batchStatus('active')">批量启用</el-button>
      <el-button size="small" @click="batchStatus('disabled')">批量停用</el-button>
      <el-button size="small" @click="batchStatus('archived')">批量归档</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column prop="name" label="评价活动" min-width="210"/>
        <el-table-column v-if="columns.visible('link')" label="邀请链接" min-width="220"><template #default="{row}"><span class="link-text">{{ inviteLink(row.linkCode) }}</span></template></el-table-column>
        <el-table-column v-if="columns.visible('period')" prop="periodName" label="评价周期" min-width="150"/>
        <el-table-column v-if="columns.visible('team')" prop="teamName" label="参与团队" min-width="120"/>
        <el-table-column v-if="columns.visible('participants')" prop="participantCount" label="邀请码数" width="95"/>
        <el-table-column v-if="columns.visible('targets')" label="评价对象" width="120"><template #default="{row}">{{row.targetTypeLabel}} · {{row.targetCount}}</template></el-table-column>
        <el-table-column v-if="columns.visible('tasks')" prop="taskCount" label="任务总数" width="95"/>
        <el-table-column v-if="columns.visible('completion')" label="完成率" width="145"><template #default="{row}"><el-progress :percentage="row.completionRate" :stroke-width="8"/></template></el-table-column>
        <el-table-column v-if="columns.visible('status')" label="状态" width="95"><template #default="{row}"><el-tag :type="statusType(row.status)">{{statusText(row.status)}}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="360" fixed="right"><template #default="{row}"><el-button link type="primary" @click="manageVerify(row)">邀请码</el-button><el-button link type="primary" @click="manageTasks(row)">任务</el-button><el-button link type="primary" @click="copy(inviteLink(row.linkCode),'邀请链接')">复制链接</el-button><el-button v-if="canWrite" link type="primary" @click="createTimedLink(row)">时效链接</el-button><el-button v-if="canWrite" link type="warning" @click="toggleStatus(row)">{{row.status==='disabled'?'启用':'停用'}}</el-button><el-button v-if="canWrite" link type="danger" :icon="Delete" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" title="创建评价活动" width="min(880px,96vw)" top="2vh" style="max-height:96vh;overflow:auto" :close-on-click-modal="false">
      <el-steps :active="step" finish-status="success" align-center class="steps"><el-step title="活动与人员"/><el-step title="确认生成"/><el-step title="分发邀请码"/></el-steps>

      <section v-if="step===0" class="step-body">
        <el-form label-position="top">
          <div class="form-grid">
            <el-form-item label="评价活动名称"><el-input v-model="form.name" placeholder="例如：研发团队季度匿名反馈" maxlength="40"/></el-form-item>
            <el-form-item label="参与团队"><el-select v-model="form.teamId" style="width:100%"><el-option v-for="team in teams" :key="team.id" :label="team.name" :value="team.id"/></el-select><small>参与评价的成员从这个团队中选择</small></el-form-item>
            <el-form-item label="邀请码生成方式" class="full"><el-radio-group v-model="form.participantMode"><el-radio-button value="selected">按成员名单生成</el-radio-button><el-radio-button value="quantity">仅指定数量</el-radio-button></el-radio-group></el-form-item>
            <el-form-item v-if="form.participantMode==='selected'" label="参与评价成员" class="full">
              <div class="select-head"><small>选中的每位成员会绑定一个匿名唯一邀请码</small><el-button link type="primary" @click="selectAllParticipants">选择全部</el-button></div>
              <el-select v-model="form.participantEmployeeIds" multiple filterable collapse-tags :max-collapse-tags="4" style="width:100%" placeholder="请选择参与成员"><el-option v-for="item in teamEmployees" :key="item.id" :label="`${item.name} · ${item.position}`" :value="item.id"/></el-select>
            </el-form-item>
            <el-form-item v-else label="邀请码数量"><el-input-number v-model="form.participantCount" :min="1" :max="200"/><small>不与团队成员总数绑定，可自由设置</small></el-form-item>

            <el-form-item label="评价对象类型" class="full"><el-radio-group v-model="form.targetType"><el-radio-button value="employee">给成员评分</el-radio-button><el-radio-button value="team">给团队评分</el-radio-button></el-radio-group><small>{{form.targetType==='team'?'每条评分直接计入所选团队，不会按团队成员分数换算':'每条评分计入一名具体成员'}}</small></el-form-item>
            <el-form-item label="评价对象范围" class="full"><el-radio-group v-model="form.targetMode"><el-radio-button value="all">{{form.targetType==='team'?'全部可管理团队':'参与团队全部启用成员'}}</el-radio-button><el-radio-button value="selected">{{form.targetType==='team'?'指定团队':'指定成员'}}</el-radio-button></el-radio-group></el-form-item>
            <el-form-item v-if="form.targetMode==='selected'" label="选择评价对象" class="full">
              <div class="select-head"><small>评价对象与邀请码数量互相独立</small><el-button link type="primary" @click="selectAllTargets">选择全部</el-button></div>
              <el-select v-if="form.targetType==='team'" v-model="form.targetTeamIds" multiple filterable collapse-tags :max-collapse-tags="4" style="width:100%" placeholder="请选择目标团队"><el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id"/></el-select>
              <el-select v-else v-model="form.targetEmployeeIds" multiple filterable collapse-tags :max-collapse-tags="4" style="width:100%" placeholder="请选择评价对象"><el-option v-for="item in teamEmployees" :key="item.id" :label="`${item.name} · ${item.position}`" :value="item.id"/></el-select>
            </el-form-item>
            <el-form-item v-if="form.targetType==='employee'" label="排除自评"><el-switch v-model="form.excludeSelf"/><small>按成员名单生成时，自动移除评价本人任务</small></el-form-item>
            <el-form-item label="评价周期" class="full"><el-radio-group v-model="form.periodMode"><el-radio-button value="new">同步新建周期</el-radio-button><el-radio-button value="existing">选择已有周期</el-radio-button></el-radio-group></el-form-item>
            <el-form-item v-if="form.periodMode==='new'" label="新周期名称" class="full"><el-input v-model="form.periodName" placeholder="例如：2026年第四季度" maxlength="40"/><small>新周期与本次评价活动使用相同的开始和结束时间</small></el-form-item>
            <el-form-item v-else label="选择评价周期" class="full"><el-select v-model="form.periodId" style="width:100%" placeholder="请选择已有评价周期"><el-option v-for="period in periods" :key="period.id" :label="`${period.name} · ${period.startTime} 至 ${period.endTime}`" :value="period.id"/></el-select><small>评价活动的开始和结束时间必须处于所选周期内</small></el-form-item>
            <el-form-item label="开始时间"><el-date-picker v-model="form.startTime" type="datetime" style="width:100%"/></el-form-item>
            <el-form-item label="结束时间"><el-date-picker v-model="form.endTime" type="datetime" style="width:100%"/></el-form-item>
          </div>
        </el-form>
      </section>

      <section v-else-if="step===1" class="step-body confirm-card">
        <h3>即将自动生成以下内容</h3>
        <div class="summary-grid">
          <div><span>评价活动</span><b>{{form.name}}</b></div>
          <div><span>评价周期</span><b>{{periodLabel}}</b></div>
          <div><span>参与团队</span><b>{{selectedTeam?.name}}</b></div>
          <div><span>邀请链接</span><b>自动生成短链</b></div>
          <div><span>邀请码</span><b>{{participantCount}} 个 6 位数字</b></div>
          <div><span>评价对象</span><b>{{targetCount}} {{form.targetType==='team'?'个团队':'人'}}</b></div>
          <div><span>预计任务</span><b>{{estimatedTaskCount}} 条</b></div>
        </div>
        <el-alert type="warning" :closable="false" show-icon title="完整邀请码仅在创建完成后展示一次，请立即下载并分别分发。"/>
      </section>

      <section v-else class="step-body result-card">
        <el-result icon="success" title="评价活动创建完成" sub-title="活动、邀请链接、邀请码和评价任务已经同步生效。"/>
        <div class="result-summary">
          <div><span>邀请链接</span><b>{{result ? inviteLink(result.activity.linkCode) : ''}}</b><el-button link type="primary" :icon="CopyDocument" @click="copy(inviteLink(result.activity.linkCode),'邀请链接')">复制</el-button></div>
          <div><span>邀请码</span><b>{{result?.participantCount}} 个</b></div>
          <div><span>评价对象</span><b>{{result?.targetCount}} {{result?.activity?.targetType==='team'?'个团队':'人'}}</b></div>
          <div><span>任务总数</span><b>{{result?.taskCount}} 条</b></div>
        </div>
        <div class="codes-box">
          <div class="codes-head"><b>邀请码</b><el-button type="primary" plain :icon="Download" @click="downloadCodes">下载全部</el-button></div>
          <div class="codes"><code v-for="item in result?.verifyCodes" :key="item.code"><span><small v-if="item.employeeName">{{item.employeeName}}</small>{{item.code}}</span></code></div>
        </div>
      </section>

      <template #footer>
        <template v-if="step===0"><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="next">下一步</el-button></template>
        <template v-else-if="step===1"><el-button @click="step=0">上一步</el-button><el-button type="primary" :loading="creating" @click="createFlow">创建并自动生成</el-button></template>
        <template v-else><el-button :icon="Download" @click="downloadCodes">下载邀请码</el-button><el-button type="primary" @click="dialog=false">完成</el-button></template>
      </template>
    </el-dialog>
  </AdminPage>
</template>

<style scoped>
.flow-tip{margin:20px 0 12px}.field-toolbar{justify-content:flex-end;margin:0 0 16px}.batch-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}.link-text{display:inline-block;max-width:100%;overflow:hidden;color:var(--brand);font-weight:650;text-overflow:ellipsis;white-space:nowrap}.code{color:var(--brand);letter-spacing:.08em}.steps{margin:6px 0 26px}.step-body{min-height:330px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.full{grid-column:1/-1}.form-grid small{display:block;margin-top:6px;color:var(--muted)}.select-head{display:flex;align-items:center;justify-content:space-between;width:100%}.confirm-card h3{margin:0 0 18px}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px}.summary-grid div,.result-summary div{display:grid;gap:7px;padding:15px;border:1px solid var(--line);border-radius:10px;background:var(--surface-warm)}.summary-grid span,.result-summary span{color:var(--muted);font-size:13px}.result-card :deep(.el-result){padding:4px 0 18px}.result-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.result-summary div{position:relative}.result-summary b{word-break:break-all}.result-summary .el-button{position:absolute;right:8px;bottom:7px}.codes-box{margin-top:18px;padding:16px;border-radius:12px;background:var(--surface-tint)}.codes-head{display:flex;align-items:center;justify-content:space-between}.codes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;max-height:240px;overflow:auto}.codes code{display:flex;align-items:center;gap:8px;padding:9px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--brand);font-weight:700}.codes span{display:grid}.codes small{color:var(--muted);font-weight:500}
@media(max-width:700px){.form-grid,.summary-grid,.result-summary{grid-template-columns:1fr}.full{grid-column:auto}.codes{grid-template-columns:1fr}.step-body{min-height:280px}}
</style>
