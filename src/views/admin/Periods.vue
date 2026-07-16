<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'

const rows = ref<any[]>([])
const dialog = ref(false)
const canWrite = ref(false)
const selectedRows = ref<any[]>([])
const form = reactive<any>({ id:'',name:'',startTime:new Date(),endTime:new Date(Date.now()+90*24*60*60*1000),status:'active' })
const selectedCount = computed(() => selectedRows.value.length)

async function load() {
  const data = unwrap<any>(await api.get('/admin/periods'))
  rows.value = data.items
  canWrite.value = Boolean(data.canWrite)
}
function add() { Object.assign(form,{id:'',name:'',startTime:new Date(),endTime:new Date(Date.now()+90*24*60*60*1000),status:'active'});dialog.value=true }
function edit(row:any) { Object.assign(form,{...row,startTime:new Date(row.startTime),endTime:new Date(row.endTime)});dialog.value=true }
async function save() {
  if (!form.name.trim()) return ElMessage.warning('请输入周期名称')
  if (new Date(form.startTime) >= new Date(form.endTime)) return ElMessage.warning('结束时间必须晚于开始时间')
  const payload = {...form,startTime:new Date(form.startTime).toISOString(),endTime:new Date(form.endTime).toISOString()}
  try {
    await (form.id ? api.put(`/admin/periods/${form.id}`,payload) : api.post('/admin/periods',payload))
    dialog.value=false
    ElMessage.success('评价周期已保存')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
}
async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除周期“${row.name}”？被评价活动使用的周期无法删除。`,'删除确认',{type:'warning'})
    await api.delete(`/admin/periods/${row.id}`)
    ElMessage.success('周期已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:any[]) { selectedRows.value = rows }
async function batchStatus(status:'active'|'inactive') {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认将选中的 ${selectedRows.value.length} 个评价周期${status === 'active' ? '启用' : '停用'}？`,'批量修改周期状态',{type:'warning'})
    await runBatchAction('periods','status',selectedRows.value,'批量状态已更新',(row) => row.name,{status})
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量操作失败')
  }
}
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 个评价周期？被评价活动使用的周期会被系统阻止删除。`,'批量删除评价周期',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('periods','delete',selectedRows.value,'已批量删除',(row) => row.name)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
onMounted(load)
</script>

<template>
  <AdminPage title="评价周期" description="周期可被多个评价活动复用；创建活动时也可以自动建立新周期">
    <template #actions><el-button v-if="canWrite" type="primary" @click="add">新增评价周期</el-button></template>
    <div v-if="canWrite && selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" @click="batchStatus('active')">批量启用</el-button>
      <el-button size="small" @click="batchStatus('inactive')">批量停用</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column prop="name" label="周期名称" min-width="220"/>
        <el-table-column prop="startTime" label="开始时间" min-width="180"/>
        <el-table-column prop="endTime" label="结束时间" min-width="180"/>
        <el-table-column label="匿名" width="90"><template #default><el-tag type="success">是</el-tag></template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="150"><template #default="{row}"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="dialog" :title="form.id?'编辑评价周期':'新增评价周期'" width="min(560px,92vw)">
      <el-form label-position="top">
        <el-form-item label="周期名称"><el-input v-model="form.name" placeholder="例如：2026年第四季度"/></el-form-item>
        <div class="date-grid">
          <el-form-item label="开始时间"><el-date-picker v-model="form.startTime" type="datetime" style="width:100%"/></el-form-item>
          <el-form-item label="结束时间"><el-date-picker v-model="form.endTime" type="datetime" style="width:100%"/></el-form-item>
        </div>
        <el-form-item label="状态"><el-switch v-model="form.status" active-value="active" inactive-value="inactive"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </AdminPage>
</template>
<style scoped>.batch-bar{display:flex;align-items:center;gap:10px;margin:20px 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}.date-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:600px){.date-grid{grid-template-columns:1fr}.batch-bar{align-items:stretch;flex-direction:column}}</style>
