<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'

const file = ref<File>()
const logs = ref<any[]>([])
const cleaning = ref(false)

function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0]
}

async function download() {
  const data = unwrap(await api.get('/admin/export/json'))
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `Lumirror-backup-${new Date().toISOString().slice(0,10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function downloadFull() {
  try {
    await ElMessageBox.confirm(
      '完整备份包含可用邀请码、密码哈希和评分关联数据，只能用于迁移或灾备。请妥善保存，不能通过聊天或公开网盘分发。',
      '导出完整敏感备份',
      { type:'warning', confirmButtonText:'确认导出', cancelButtonText:'取消' }
    )
    const data = unwrap(await api.post('/admin/export/full-json',{confirm:'EXPORT_FULL_BACKUP'}))
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Lumirror-full-backup-${new Date().toISOString().slice(0,10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    await loadLogs()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  }
}

async function upload() {
  if (!file.value) return ElMessage.warning('请选择 JSON 文件')
  try {
    await ElMessageBox.confirm(
      '导入会覆盖当前成员、组织、评价活动、任务和评分数据，后台账号会保留。请确认文件来源可信。',
      '确认导入数据',
      { type:'warning', confirmButtonText:'确认导入', cancelButtonText:'取消' }
    )
    const data = JSON.parse(await file.value.text())
    await api.post('/admin/import/json',{data})
    ElMessage.success('导入成功')
    await loadLogs()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error instanceof Error ? error.message : '导入失败，请检查 JSON 文件')
  }
}
async function cleanup() {
  cleaning.value = true
  try {
    const result = unwrap<any>(await api.post('/admin/maintenance/cleanup'))
    ElMessage.success(`清理完成：移除日志 ${result.removedLogs} 条，任务 ${result.removedTasks} 条`)
    await loadLogs()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '清理失败')
  } finally { cleaning.value = false }
}
async function loadLogs() {
  try {
    const data = unwrap<any>(await api.get('/admin/logs?limit=20'))
    logs.value = data.items || []
  } catch { logs.value = [] }
}
onMounted(loadLogs)
</script>

<template>
  <AdminPage title="导入与导出" description="备份或迁移系统中的 JSON 结构化数据。">
    <div class="io-grid">
      <section class="panel io-card">
        <h3>导出系统数据</h3>
        <p>导出成员、组织、评价活动、任务、评分与系统设置。为安全起见，密码哈希和邀请码会脱敏。</p>
        <el-button type="primary" @click="download">导出脱敏 JSON</el-button>
        <el-button type="danger" plain @click="downloadFull">导出完整备份</el-button>
      </section>
      <section class="panel io-card">
        <h3>导入系统数据</h3>
        <p>导入会覆盖当前业务数据。请先下载备份，并确认文件来源可信。</p>
        <input type="file" accept="application/json,.json" @change="choose"/>
        <el-button type="warning" @click="upload">校验并导入</el-button>
      </section>
      <section class="panel io-card">
        <h3>维护清理</h3>
        <p>清理过期日志、刷新时效邀请状态，并移除已失去活动关联的未提交任务。</p>
        <el-button type="primary" plain :loading="cleaning" @click="cleanup">执行维护清理</el-button>
      </section>
      <section class="panel io-card logs">
        <div class="card-head"><h3>最近操作日志</h3><el-button size="small" @click="loadLogs">刷新</el-button></div>
        <el-empty v-if="!logs.length" description="暂无日志" :image-size="80"/>
        <div v-else class="log-list">
          <div v-for="item in logs" :key="item.id" class="log-item">
            <b>{{ item.action }}</b>
            <span>{{ item.actorName || '系统' }} · {{ item.createdAt }}</span>
          </div>
        </div>
      </section>
    </div>
  </AdminPage>
</template>

<style scoped>
.io-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}.io-card{padding:28px}.io-card h3{margin:0 0 10px}.io-card p{min-height:48px;color:var(--muted);line-height:1.7}.io-card input{display:block;margin:18px 0}.io-card .el-button+.el-button{margin-left:10px}.card-head{display:flex;align-items:center;justify-content:space-between}.log-list{display:grid;gap:8px;max-height:250px;overflow:auto}.log-item{display:grid;gap:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff}.log-item b{color:var(--ink);font-size:13px}.log-item span{color:var(--muted);font-size:12px}@media(max-width:700px){.io-grid{grid-template-columns:1fr}.io-card .el-button+.el-button{margin:10px 0 0}}
</style>
