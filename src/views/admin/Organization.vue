<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'

const route = useRoute()
const kind = computed(() => String(route.meta.kind))
const title = computed(() => kind.value === 'teams' ? '团队管理' : '部门管理')
const rows = ref<any[]>([])
const dialog = ref(false)
const loading = ref(false)
const canWrite = ref(false)
const selectedRows = ref<any[]>([])
const form = reactive<any>({id:'',name:'',departmentId:'',leader:'',sort:1,status:'active'})
const departments = ref<any[]>([])
const selectedCount = computed(() => selectedRows.value.length)

async function load() {
  loading.value = true
  try {
    const result = unwrap<any>(await api.get(`/admin/${kind.value}`))
    rows.value = result.items || result
    departments.value = result.departments || []
    canWrite.value = Boolean(result.canWrite)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
  finally { loading.value = false }
}
function add() {
  Object.assign(form,{id:'',name:'',departmentId:departments.value[0]?.id||'',leader:'',sort:rows.value.length+1,status:'active'})
  dialog.value = true
}
function edit(row:any) { Object.assign(form,row); dialog.value = true }
async function save() {
  if (!form.name.trim()) return ElMessage.warning('请输入名称')
  try {
    await (form.id ? api.put(`/admin/${kind.value}/${form.id}`,form) : api.post(`/admin/${kind.value}`,form))
    dialog.value = false
    ElMessage.success('保存成功')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
}
async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除“${row.name}”？存在成员、团队或评价活动时系统会阻止删除。`,'删除确认',{type:'warning',confirmButtonText:'确认删除'})
    await api.delete(`/admin/${kind.value}/${row.id}`)
    ElMessage.success('已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:any[]) { selectedRows.value = rows }
async function batchStatus(status:'active'|'inactive') {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认将选中的 ${selectedRows.value.length} 个${kind.value==='teams'?'团队':'部门'}${status === 'active' ? '启用' : '停用'}？`,'批量修改状态',{type:'warning'})
    await runBatchAction(kind.value,'status',selectedRows.value,'批量状态已更新',(row) => row.name,{status})
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量操作失败')
  }
}
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 个${kind.value==='teams'?'团队':'部门'}？存在成员、团队或评价活动时系统会阻止删除。`,'批量删除',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction(kind.value,'delete',selectedRows.value,'已批量删除',(row) => row.name)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
watch(kind,load)
onMounted(load)
</script>

<template>
  <AdminPage :title="title" :description="kind==='teams'?'维护团队及所属部门；团队长仅可查看自己的团队':'维护公司部门基础资料'">
    <template #actions><el-button v-if="canWrite" type="primary" @click="add">新增{{kind==='teams'?'团队':'部门'}}</el-button></template>
    <div v-if="canWrite && selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" @click="batchStatus('active')">批量启用</el-button>
      <el-button size="small" @click="batchStatus('inactive')">批量停用</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table v-loading="loading" :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column prop="name" :label="kind==='teams'?'团队名称':'部门名称'" min-width="170"/>
        <el-table-column v-if="kind==='teams'" prop="departmentName" label="所属部门" min-width="140"/>
        <el-table-column prop="leader" label="负责人" min-width="120"/>
        <el-table-column prop="sort" label="排序" width="90"/>
        <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="150"><template #default="{row}"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>
    <el-dialog v-model="dialog" :title="`${form.id?'编辑':'新增'}${kind==='teams'?'团队':'部门'}`" width="min(520px,94vw)">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="form.name" maxlength="30"/></el-form-item>
        <el-form-item v-if="kind==='teams'" label="所属部门"><el-select v-model="form.departmentId" style="width:100%"><el-option v-for="x in departments" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
        <el-form-item label="负责人"><el-input v-model="form.leader" maxlength="20"/></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="1"/></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.status" active-value="active" inactive-value="inactive"/></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </AdminPage>
</template>
<style scoped>.batch-bar{display:flex;align-items:center;gap:10px;margin:20px 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}@media(max-width:650px){.batch-bar{align-items:stretch;flex-direction:column}}</style>
