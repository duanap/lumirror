<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'
import { storeUser } from '../../lib/auth'
import type { BackendUser } from '../../types'

const router = useRouter()
const form = reactive({ systemName:'和光镜鉴', publicSessionMinutes:120, logRetentionDays:90 })
const canEdit = ref(false)
const password = reactive({ currentPassword:'',newPassword:'',confirmPassword:'' })
const deployment = ref<any>(null)

async function load() {
  const data = unwrap<any>(await api.get('/admin/settings'))
  Object.assign(form,data)
  canEdit.value = Boolean(data.canEdit)
  if (canEdit.value) await loadDeploymentCheck()
}
async function loadDeploymentCheck() {
  try { deployment.value = unwrap<any>(await api.get('/admin/deployment-check')) }
  catch { deployment.value = null }
}
async function save() {
  try {
    await api.put('/admin/settings',form)
    ElMessage.success('基础设置已保存')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
}
async function changePassword() {
  if (password.newPassword.length < 8) return ElMessage.warning('新密码至少 8 位')
  if (password.newPassword !== password.confirmPassword) return ElMessage.warning('两次输入的新密码不一致')
  try {
    await api.post('/admin/change-password',password)
    Object.assign(password,{currentPassword:'',newPassword:'',confirmPassword:''})
    const me = unwrap(await api.get<BackendUser>('/admin/me'))
    storeUser(me)
    ElMessage.success('登录密码已修改')
    await router.replace('/admin/dashboard')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '修改失败') }
}
onMounted(load)
</script>

<template>
  <AdminPage title="基础与安全设置" description="管理员维护系统参数；所有后台账号都可以修改自己的登录密码。">
    <div class="setting-grid">
      <section class="panel settings">
        <h3>基础设置</h3>
        <el-alert v-if="!canEdit" title="当前角色仅可查看基础设置" type="info" :closable="false" class="alert"/>
        <el-form label-position="top">
          <el-form-item label="系统名称"><el-input v-model="form.systemName" :disabled="!canEdit"/></el-form-item>
          <el-form-item label="匿名评价会话有效期（分钟）"><el-input-number v-model="form.publicSessionMinutes" :min="15" :disabled="!canEdit"/></el-form-item>
          <el-form-item label="操作日志保留天数"><el-input-number v-model="form.logRetentionDays" :min="30" :disabled="!canEdit"/></el-form-item>
          <el-button v-if="canEdit" type="primary" @click="save">保存设置</el-button>
        </el-form>
      </section>
      <section class="panel settings">
        <h3>修改登录密码</h3>
        <el-alert title="密码至少 8 位，不要与其他系统共用；首次使用默认账号后请立即修改。" type="warning" :closable="false" class="alert"/>
        <el-form label-position="top">
          <el-form-item label="当前密码"><el-input v-model="password.currentPassword" type="password" show-password autocomplete="current-password"/></el-form-item>
          <el-form-item label="新密码"><el-input v-model="password.newPassword" type="password" show-password autocomplete="new-password"/></el-form-item>
          <el-form-item label="确认新密码"><el-input v-model="password.confirmPassword" type="password" show-password autocomplete="new-password"/></el-form-item>
          <el-button type="primary" @click="changePassword">修改密码</el-button>
        </el-form>
      </section>
      <section v-if="canEdit && deployment" class="panel settings full">
        <div class="section-head">
          <h3>部署检查</h3>
          <el-button size="small" @click="loadDeploymentCheck">重新检查</el-button>
        </div>
        <div class="check-summary">
          <span>通过 <b>{{ deployment.summary.pass }}</b></span>
          <span>警告 <b>{{ deployment.summary.warn }}</b></span>
          <span>失败 <b>{{ deployment.summary.fail }}</b></span>
        </div>
        <div class="check-list">
          <div v-for="item in deployment.checks" :key="item.id" class="check-item">
            <el-tag :type="item.status==='pass'?'success':item.status==='fail'?'danger':'warning'">{{ item.status==='pass'?'通过':item.status==='fail'?'失败':'警告' }}</el-tag>
            <div><b>{{ item.label }}</b><small>{{ item.message }}</small></div>
          </div>
        </div>
      </section>
    </div>
  </AdminPage>
</template>

<style scoped>
.setting-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px}.settings{padding:26px}.full{grid-column:1/-1}h3{margin:0 0 18px;color:var(--ink);font-size:17px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-head h3{margin:0}.alert{margin-bottom:18px}.settings :deep(.el-input-number){width:180px}.check-summary{display:flex;gap:12px;margin:18px 0}.check-summary span{padding:8px 12px;border-radius:8px;background:#fff7f2;color:var(--muted)}.check-summary b{color:var(--brand)}.check-list{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.check-item{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid var(--line);border-radius:8px;background:#fff}.check-item b{display:block;color:var(--ink)}.check-item small{display:block;margin-top:4px;color:var(--muted);line-height:1.5}@media(max-width:900px){.setting-grid,.check-list{grid-template-columns:1fr}.settings{padding:22px}}
</style>
