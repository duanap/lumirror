<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import AdminPage from '../../components/AdminPage.vue'
import ColumnSettings from '../../components/ColumnSettings.vue'
import { api, unwrap } from '../../lib/api'
import { runBatchAction } from '../../lib/batch'
import { useColumnSettings } from '../../lib/columns'

const rows = ref<any[]>([])
const options = ref<any>({ roles:[], teams:[], departments:[], employees:[] })
const dialog = ref(false)
const loading = ref(false)
const selectedRows = ref<any[]>([])
const form = reactive<any>({
  id:'', username:'', displayName:'', password:'', role:'team_leader',
  departmentId:'', teamId:'', employeeId:'', status:'active',mustChangePassword:true
})

const filteredTeams = computed(() => form.departmentId
  ? options.value.teams.filter((x:any) => x.departmentId === form.departmentId)
  : options.value.teams)
const filteredEmployees = computed(() => form.teamId
  ? options.value.employees.filter((x:any) => x.teamId === form.teamId)
  : options.value.employees)
const selectedCount = computed(() => selectedRows.value.length)
const userColumns = [
  { key:'displayName', label:'显示名称' },
  { key:'role', label:'角色' },
  { key:'scope', label:'数据范围' },
  { key:'status', label:'状态' }
]
const columns = useColumnSettings('lumirror.admin.users.columns', userColumns)
const visibleColumns = columns.selected
const selectableColumns = columns.selectable

async function load() {
  loading.value = true
  try {
    const data = unwrap<any>(await api.get('/admin/users'))
    rows.value = data.items
    options.value = data.options
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
  finally { loading.value = false }
}
function resetScopeByRole() {
  if (form.role === 'admin') Object.assign(form,{departmentId:'',teamId:'',employeeId:''})
  if (form.role === 'leader') Object.assign(form,{teamId:'',employeeId:''})
  if (form.role === 'team_leader') form.employeeId = ''
}
function add() {
  Object.assign(form,{id:'',username:'',displayName:'',password:'',role:'team_leader',departmentId:'',teamId:'',employeeId:'',status:'active',mustChangePassword:true})
  dialog.value = true
}
function edit(row:any) {
  Object.assign(form,{...row,password:''})
  dialog.value = true
}
async function save() {
  if (!form.username.trim() || !form.displayName.trim()) return ElMessage.warning('请填写账号和显示名称')
  if (!form.id && form.password.length < 8) return ElMessage.warning('初始密码至少 8 位')
  if (form.role === 'leader' && !form.departmentId) return ElMessage.warning('领导账号必须绑定部门')
  if (form.role === 'team_leader' && !form.teamId) return ElMessage.warning('团队长账号必须绑定团队')
  if (form.role === 'member' && !form.employeeId) return ElMessage.warning('成员账号必须绑定员工')
  try {
    await (form.id ? api.put(`/admin/users/${form.id}`,form) : api.post('/admin/users',form))
    dialog.value = false
    ElMessage.success('账号已保存')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
}
async function remove(row:any) {
  try {
    await ElMessageBox.confirm(`确认删除后台账号“${row.username}”？系统会至少保留一个后台账号，此操作不可恢复。`,'删除账号',{type:'warning',confirmButtonText:'确认删除'})
    await api.delete(`/admin/users/${row.id}`)
    ElMessage.success('账号已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:any[]) { selectedRows.value = rows }
async function batchStatus(status:'active'|'inactive') {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认将选中的 ${selectedRows.value.length} 个账号${status === 'active' ? '启用' : '停用'}？`,'批量修改账号状态',{type:'warning'})
    await runBatchAction('users','status',selectedRows.value,'批量状态已更新',(row) => row.username,{status})
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量操作失败')
  }
}
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 个后台账号？系统会阻止删除当前账号、最后一个管理员，且至少保留一个后台账号。`,'批量删除账号',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('users','delete',selectedRows.value,'已批量删除',(row) => row.username)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
function roleType(role:string) {
  return role === 'admin' ? 'danger' : role === 'team_leader' ? 'warning' : role === 'leader' ? 'success' : 'info'
}
onMounted(load)
</script>

<template>
  <AdminPage title="账号与权限" description="为管理员、团队长、领导和成员分配不同的数据范围与操作权限">
    <template #actions><el-button type="primary" :icon="Plus" @click="add">新增账号</el-button></template>
    <el-alert class="notice" type="info" :closable="false" show-icon title="团队长仅管理绑定团队；领导仅查看绑定部门；成员不显示评分结果。"/>
    <div class="toolbar field-toolbar"><ColumnSettings v-model="visibleColumns" :options="selectableColumns" @reset="columns.reset"/></div>
    <div v-if="selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" @click="batchStatus('active')">批量启用</el-button>
      <el-button size="small" @click="batchStatus('inactive')">批量停用</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table v-loading="loading" :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column prop="username" label="登录账号" min-width="130"/>
        <el-table-column v-if="columns.visible('displayName')" prop="displayName" label="显示名称" min-width="130"/>
        <el-table-column v-if="columns.visible('role')" label="角色" width="105"><template #default="{row}"><el-tag :type="roleType(row.role)">{{row.roleLabel}}</el-tag></template></el-table-column>
        <el-table-column v-if="columns.visible('scope')" label="数据范围" min-width="210"><template #default="{row}"><span v-if="row.role==='admin'">全部数据</span><span v-else-if="row.role==='leader'">部门：{{ options.departments.find((x:any)=>x.id===row.departmentId)?.name || '未绑定' }}</span><span v-else-if="row.role==='team_leader'">团队：{{ options.teams.find((x:any)=>x.id===row.teamId)?.name || '未绑定' }}</span><span v-else>成员：{{ options.employees.find((x:any)=>x.id===row.employeeId)?.name || '未绑定' }}</span></template></el-table-column>
        <el-table-column v-if="columns.visible('status')" label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id?'编辑账号':'新增账号'" width="min(620px,94vw)" :close-on-click-modal="false">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="登录账号"><el-input v-model="form.username" maxlength="32" placeholder="3-32位字母或数字"/></el-form-item>
          <el-form-item label="显示名称"><el-input v-model="form.displayName" maxlength="30"/></el-form-item>
          <el-form-item :label="form.id?'重置密码（留空不修改）':'初始密码'"><el-input v-model="form.password" type="password" show-password placeholder="至少8位"/></el-form-item>
          <el-form-item v-if="!form.id" label="首次登录强制修改密码"><el-switch v-model="form.mustChangePassword"/><small>关闭后可直接使用初始密码进入后台</small></el-form-item>
          <el-form-item label="角色"><el-select v-model="form.role" style="width:100%" @change="resetScopeByRole"><el-option v-for="role in options.roles" :key="role.value" :label="role.label" :value="role.value"/></el-select></el-form-item>
          <el-form-item v-if="form.role==='leader'" label="绑定部门"><el-select v-model="form.departmentId" style="width:100%"><el-option v-for="x in options.departments" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
          <template v-if="form.role==='team_leader'">
            <el-form-item label="所属部门"><el-select v-model="form.departmentId" clearable style="width:100%"><el-option v-for="x in options.departments" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
            <el-form-item label="绑定团队"><el-select v-model="form.teamId" style="width:100%"><el-option v-for="x in filteredTeams" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
          </template>
          <template v-if="form.role==='member'">
            <el-form-item label="所属团队"><el-select v-model="form.teamId" clearable style="width:100%"><el-option v-for="x in options.teams" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
            <el-form-item label="绑定成员"><el-select v-model="form.employeeId" filterable style="width:100%"><el-option v-for="x in filteredEmployees" :key="x.id" :label="`${x.name} · ${x.teamName}`" :value="x.id"/></el-select></el-form-item>
          </template>
          <el-form-item label="状态"><el-switch v-model="form.status" active-value="active" inactive-value="inactive"/></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </AdminPage>
</template>

<style scoped>
.notice{margin:20px 0 12px}.field-toolbar{justify-content:flex-end;margin:0 0 16px}.batch-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.form-grid small{display:block;margin-top:6px;color:var(--muted)}@media(max-width:650px){.form-grid{grid-template-columns:1fr}.batch-bar{align-items:stretch;flex-direction:column}}
</style>
