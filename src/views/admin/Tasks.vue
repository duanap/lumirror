<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import ColumnSettings from '../../components/ColumnSettings.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'
import { useColumnSettings } from '../../lib/columns'

const rows = ref<any[]>([])
const route = useRoute()
const activities = ref<any[]>([])
const selected = ref('')
const loading = ref(false)
const canWrite = ref(false)
const selectedRows = ref<any[]>([])
const taskColumns = [
  { key:'activity', label:'评价活动' },
  { key:'verifyCode', label:'邀请码' },
  { key:'participant', label:'评价成员' },
  { key:'target', label:'被评价人' },
  { key:'team', label:'团队' },
  { key:'status', label:'状态' },
  { key:'submittedAt', label:'提交时间' }
]
const columns = useColumnSettings('lumirror.admin.tasks.columns', taskColumns)
const visibleColumns = columns.selected
const selectableColumns = columns.selectable

async function load() {
  loading.value = true
  try {
    if (!selected.value && route.query.evaluationCodeId) selected.value = String(route.query.evaluationCodeId)
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/tasks${query}`))
    rows.value = data.items
    activities.value = data.activities
    canWrite.value = Boolean(data.canWrite)
    if (!selected.value && activities.value.length) selected.value = activities.value[0].id
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
  finally { loading.value = false }
}
async function repair() {
  if (!selected.value) return ElMessage.warning('请选择评价活动')
  loading.value = true
  try {
    const data = unwrap<any>(await api.post('/admin/tasks/generate',{evaluationCodeId:selected.value}))
    ElMessage.success(data.created||data.removed ? `已新增 ${data.created} 条、移除 ${data.removed} 条无效待评价任务` : '任务完整，无需调整')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '修复失败') }
  finally { loading.value = false }
}
async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除“${row.participantName} → ${row.targetName}”的待评价任务？`,'删除任务',{type:'warning'})
    await api.delete(`/admin/tasks/${row.id}`)
    ElMessage.success('任务已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:any[]) { selectedRows.value = rows }
async function batchRemove() {
  const removable = selectedRows.value.filter((row) => row.status !== 'submitted')
  if (!removable.length) return ElMessage.warning('请选择待评价任务')
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${removable.length} 条待评价任务？已提交任务不会删除。`,'批量删除任务',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('tasks','delete',removable,'已批量删除',(row) => `${row.participantName} → ${row.targetName}`)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
onMounted(load)
</script>

<template>
  <AdminPage title="评价任务" description="按活动查看参与成员与评价对象的任务关系，修复功能会按活动当前范围补齐任务">
    <template #actions><el-button v-if="canWrite" type="primary" plain :loading="loading" @click="repair">检查并同步任务</el-button></template>
    <div class="toolbar filter-toolbar">
      <el-select v-model="selected" placeholder="筛选评价活动" clearable style="width:360px" @change="load"><el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/></el-select>
      <el-button @click="load">刷新</el-button>
      <el-button v-if="canWrite && selectedRows.length" type="danger" plain @click="batchRemove">批量删除</el-button>
      <ColumnSettings v-model="visibleColumns" :options="selectableColumns" @reset="columns.reset"/>
    </div>
    <div class="panel table-wrap">
      <el-table v-loading="loading" :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column v-if="columns.visible('activity')" prop="activityName" label="评价活动" min-width="180"/>
        <el-table-column v-if="columns.visible('verifyCode')" prop="verifyCode" label="邀请码" width="125"/>
        <el-table-column v-if="columns.visible('participant')" prop="participantName" label="评价成员" min-width="110"/>
        <el-table-column v-if="columns.visible('target')" prop="targetName" label="被评价人" min-width="110"/>
        <el-table-column v-if="columns.visible('team')" prop="teamName" label="团队" min-width="110"/>
        <el-table-column v-if="columns.visible('status')" label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='submitted'?'success':'warning'">{{row.status==='submitted'?'已提交':'待评价'}}</el-tag></template></el-table-column>
        <el-table-column v-if="columns.visible('submittedAt')" prop="submittedAt" label="提交时间" min-width="170"/>
        <el-table-column v-if="canWrite" label="操作" width="90" fixed="right"><template #default="{row}"><el-button link type="danger" :disabled="row.status==='submitted'" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>
  </AdminPage>
</template>

<style scoped>.filter-toolbar{justify-content:flex-start}@media(max-width:600px){.filter-toolbar{flex-direction:column}.filter-toolbar .el-select{width:100%!important}}</style>
