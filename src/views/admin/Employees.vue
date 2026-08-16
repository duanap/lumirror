<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Plus, Search, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import ColumnSettings from '../../components/ColumnSettings.vue'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import { api, unwrap } from '../../lib/api'
import { AVATAR_PRESETS, avatarPresetById } from '../../lib/avatars'
import { runBatchAction } from '../../lib/batch'
import { useColumnSettings } from '../../lib/columns'
import type { Employee } from '../../types'

const rows = ref<Employee[]>([])
const loading = ref(false)
const dialog = ref(false)
const canWrite = ref(false)
const selectedRows = ref<Employee[]>([])
const filters = reactive({ q:'', departmentId:'', teamId:'', status:'' })
const form = reactive<Employee>({id:'',name:'',gender:'male',departmentId:'',teamId:'',position:'',status:'active',avatar:''})
const options = ref<any>({departments:[],teams:[]})

const filterTeams = computed(() => filters.departmentId
  ? options.value.teams.filter((x:any) => x.departmentId === filters.departmentId)
  : options.value.teams)
const formTeams = computed(() => form.departmentId
  ? options.value.teams.filter((x:any) => x.departmentId === form.departmentId)
  : options.value.teams)
const genderAvatars = computed(() => form.gender === 'unknown'
  ? []
  : AVATAR_PRESETS.filter((item) => item.gender === form.gender))
const selectedCount = computed(() => selectedRows.value.length)
const employeeColumns = [
  { key:'gender', label:'性别' },
  { key:'department', label:'部门' },
  { key:'team', label:'团队' },
  { key:'position', label:'岗位' },
  { key:'status', label:'状态' }
]
const columns = useColumnSettings('lumirror.admin.employees.columns', employeeColumns)
const visibleColumns = columns.selected
const selectableColumns = columns.selectable

function queryString() {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key,value]) => { if (value) params.set(key,value) })
  return params.toString() ? `?${params}` : ''
}
async function load() {
  loading.value = true
  try {
    const result = unwrap<any>(await api.get(`/admin/employees${queryString()}`))
    rows.value = result.items
    options.value = result.options
    canWrite.value = result.canWrite
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载失败') }
  finally { loading.value = false }
}
function resetFilters() {
  Object.assign(filters,{q:'',departmentId:'',teamId:'',status:''})
  load()
}
function add() {
  const firstTeam = options.value.teams[0]
  Object.assign(form,{id:'',name:'',gender:'male',departmentId:firstTeam?.departmentId||'',teamId:firstTeam?.id||'',position:'',status:'active',avatar:''})
  dialog.value = true
}
function edit(row:Employee) {
  const preset = avatarPresetById(row.avatar)
  Object.assign(form,{...row,avatar:preset?.gender === row.gender ? preset.id : ''})
  dialog.value = true
}
async function save() {
  if (!form.name.trim() || !form.position.trim()) return ElMessage.warning('请填写姓名和岗位')
  if (!form.teamId || !form.departmentId) return ElMessage.warning('请选择部门和团队')
  try {
    await (form.id ? api.put(`/admin/employees/${form.id}`,form) : api.post('/admin/employees',form))
    dialog.value = false
    ElMessage.success('成员信息已保存')
    await load()
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
}
async function remove(row:Employee) {
  try {
    await ElMessageBox.confirm(`确认删除成员“${row.name}”？有历史评分时系统会阻止删除，建议改为停用。`,'删除确认',{type:'warning',confirmButtonText:'确认删除'})
    await api.delete(`/admin/employees/${row.id}`)
    ElMessage.success('成员已删除')
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}
function onSelectionChange(rows:Employee[]) { selectedRows.value = rows }
async function batchStatus(status:'active'|'inactive') {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认将选中的 ${selectedRows.value.length} 名成员${status === 'active' ? '启用' : '停用'}？`,'批量修改成员状态',{type:'warning'})
    await runBatchAction('employees','status',selectedRows.value,'批量状态已更新',(row) => row.name,{status})
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量操作失败')
  }
}
async function batchRemove() {
  if (!selectedRows.value.length) return
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedRows.value.length} 名成员？有历史评分时系统会阻止删除。`,'批量删除成员',{type:'warning',confirmButtonText:'确认删除'})
    await runBatchAction('employees','delete',selectedRows.value,'已批量删除',(row) => row.name)
    await load()
  } catch (error:any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}
watch(() => filters.departmentId, () => {
  if (filters.teamId && !filterTeams.value.some((x:any) => x.id === filters.teamId)) filters.teamId = ''
})
watch(() => form.departmentId, () => {
  if (form.teamId && !formTeams.value.some((x:any) => x.id === form.teamId)) form.teamId = formTeams.value[0]?.id || ''
})
watch(() => form.gender, (gender) => {
  if (avatarPresetById(form.avatar)?.gender !== gender) form.avatar = ''
})
onMounted(load)
</script>

<template>
  <AdminPage title="成员管理" description="按部门和团队筛选成员，维护参与评价的人员、岗位与状态">
    <template #actions><el-button v-if="canWrite" type="primary" :icon="Plus" @click="add">新增成员</el-button></template>
    <div class="filter-panel panel">
      <el-input v-model="filters.q" :prefix-icon="Search" clearable placeholder="姓名、岗位、团队、部门" @keyup.enter="load"/>
      <el-select v-model="filters.departmentId" clearable placeholder="全部部门">
        <el-option v-for="x in options.departments" :key="x.id" :label="x.name" :value="x.id"/>
      </el-select>
      <el-select v-model="filters.teamId" clearable placeholder="全部团队">
        <el-option v-for="x in filterTeams" :key="x.id" :label="x.name" :value="x.id"/>
      </el-select>
      <el-select v-model="filters.status" clearable placeholder="全部状态"><el-option label="启用" value="active"/><el-option label="停用" value="inactive"/></el-select>
      <el-button type="primary" @click="load">查询</el-button>
      <el-button :icon="Refresh" @click="resetFilters">重置</el-button>
      <ColumnSettings v-model="visibleColumns" :options="selectableColumns" @reset="columns.reset"/>
    </div>
    <div v-if="canWrite && selectedCount" class="batch-bar panel">
      <span>已选择 <b>{{ selectedCount }}</b> 项</span>
      <el-button size="small" @click="batchStatus('active')">批量启用</el-button>
      <el-button size="small" @click="batchStatus('inactive')">批量停用</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
    </div>
    <div class="panel table-wrap">
      <el-table v-loading="loading" :data="rows" row-key="id" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="46"/>
        <el-table-column label="成员" min-width="175"><template #default="{row}"><div class="person"><EmployeeAvatar :avatar="row.avatar" :gender="row.gender" :size="42" :alt="`${row.name}的头像`"/><div><b>{{row.name}}</b><small>{{row.position || '未设置岗位'}}</small></div></div></template></el-table-column>
        <el-table-column v-if="columns.visible('gender')" label="性别" width="80"><template #default="{row}"><el-tag size="small" :class="{'gender-tag--female':row.gender==='female'}" :type="row.gender==='female'?'danger':row.gender==='male'?'primary':'info'">{{row.gender==='female'?'女':row.gender==='male'?'男':'未知'}}</el-tag></template></el-table-column>
        <el-table-column v-if="columns.visible('department')" prop="departmentName" label="部门" min-width="120"/>
        <el-table-column v-if="columns.visible('team')" prop="teamName" label="团队" min-width="120"/>
        <el-table-column v-if="columns.visible('position')" prop="position" label="岗位" min-width="130"/>
        <el-table-column v-if="columns.visible('status')" label="状态" width="85"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'启用':'停用'}}</el-tag></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="150" fixed="right"><template #default="{row}"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialog" :title="form.id?'编辑成员':'新增成员'" width="min(620px,94vw)" :close-on-click-modal="false">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="姓名"><el-input v-model="form.name" maxlength="20"/></el-form-item>
          <el-form-item label="性别"><el-select v-model="form.gender" style="width:100%"><el-option label="男" value="male"/><el-option label="女" value="female"/><el-option label="未知" value="unknown"/></el-select></el-form-item>
          <el-form-item label="所属部门"><el-select v-model="form.departmentId" style="width:100%"><el-option v-for="x in options.departments" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
          <el-form-item label="所属团队"><el-select v-model="form.teamId" style="width:100%"><el-option v-for="x in formTeams" :key="x.id" :label="x.name" :value="x.id"/></el-select></el-form-item>
          <el-form-item label="岗位"><el-input v-model="form.position" maxlength="30"/></el-form-item>
          <el-form-item label="状态"><el-switch v-model="form.status" active-value="active" inactive-value="inactive"/></el-form-item>
          <el-form-item class="avatar-field" label="头像">
            <div class="avatar-picker">
              <div class="avatar-picker-head">
                <span>{{form.gender==='unknown' ? '请选择男或女后再选择头像' : `仅可选择${form.gender==='female'?'女生':'男生'}头像`}}</span>
              </div>
              <div class="avatar-options">
                <button v-for="avatar in genderAvatars" :key="avatar.id" type="button" class="avatar-option" :class="{selected:form.avatar===avatar.id}" @click="form.avatar=avatar.id">
                  <EmployeeAvatar :avatar="avatar.id" :gender="avatar.gender" :size="64" :alt="avatar.label"/>
                  <small>{{avatar.label}}</small>
                </button>
              </div>
            </div>
          </el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </AdminPage>
</template>

<style scoped>
.filter-panel{display:grid;grid-template-columns:minmax(200px,1.4fr) repeat(3,minmax(140px,1fr)) auto auto auto;gap:10px;margin:20px 0 16px;padding:14px}.batch-bar{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 14px}.batch-bar span{margin-right:auto;color:var(--muted)}.batch-bar b{color:var(--brand)}.person{display:flex;align-items:center;gap:10px}.person small{display:block;margin-top:4px;color:var(--subtle)}.gender-tag--female{--el-tag-bg-color:transparent}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.avatar-field{grid-column:1/-1}.avatar-picker{width:100%;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-tint)}.avatar-picker-head{margin-bottom:12px;color:var(--muted);font-size:12px}.avatar-options{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.avatar-option{display:grid;justify-items:center;gap:6px;min-width:0;padding:8px 4px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--subtle);cursor:pointer;transition:border-color .16s ease,background .16s ease,color .16s ease}.avatar-option:hover,.avatar-option.selected{border-color:var(--brand);color:var(--brand);background:var(--surface)}.avatar-option small{max-width:100%;overflow:hidden;font-size:10px;line-height:1.25;text-align:center;text-overflow:ellipsis;white-space:nowrap}@media(max-width:1180px){.filter-panel{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.filter-panel,.form-grid{grid-template-columns:1fr}.filter-panel{padding:12px}.batch-bar{align-items:stretch;flex-direction:column}.avatar-options{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
