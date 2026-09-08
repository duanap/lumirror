<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'

const file = ref<File>()
const logs = ref<any[]>([])
const cleaning = ref(false)
const importing = ref(false)

function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0]
}
function saveJson(data:unknown, filename:string) {
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
async function download() {
  try {
    const data = unwrap(await api.get('/admin/export/json'))
    saveJson(data,`Lumirror-statistics-${new Date().toISOString().slice(0,10)}.json`)
    ElMessage.success('匿名统计报告已导出；该文件不可用于恢复系统')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '导出失败') }
}

async function downloadFull() {
  try {
    await ElMessageBox.confirm(
      '完整备份包含可用邀请码、密码哈希、任务与评分关联，只能用于迁移或灾备。请使用受控存储，不要通过聊天、邮件或公开网盘分发。',
      '导出完整敏感备份',
      { type:'warning', confirmButtonText:'确认导出', cancelButtonText:'取消' }
    )
    const data = unwrap(await api.post('/admin/export/full-json',{confirm:'EXPORT_FULL_BACKUP'}))
    saveJson(data,`Lumirror-full-backup-${new Date().toISOString().slice(0,10)}.json`)
    await loadLogs()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  }
}

async function upload() {
  if (!file.value) return ElMessage.warning('请选择完整备份 JSON 文件')
  importing.value = true
  try {
    const data = JSON.parse(await file.value.text())
    const preview = unwrap<any>(await api.post('/admin/import/preflight',{data}))
    const counts = preview.counts || {}
    await ElMessageBox.confirm(
      `预检通过：成员 ${counts.employees || 0}，活动 ${counts.evaluationCodes || 0}，任务 ${counts.tasks || 0}，评分 ${counts.scores || 0}。导入将原子替换当前业务数据，同时保留后台账号并使旧会话失效。`,
      '确认恢复完整备份',
      { type:'warning', confirmButtonText:'确认覆盖并恢复', cancelButtonText:'取消' }
    )
    await api.post('/admin/import/json',{data,confirm:'IMPORT_REPLACE_DATA',previewHash:preview.previewHash,revision:preview.revision})
    file.value = undefined
    ElMessage.success('恢复成功，当前浏览器会话已刷新')
    await loadLogs()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error instanceof SyntaxError ? 'JSON 文件格式无效' : error instanceof Error ? error.message : '恢复失败')
  } finally { importing.value = false }
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
  <AdminPage title="导入与导出" description="匿名统计分享与完整灾备使用两条独立的数据通道。">
    <div class="io-grid">
      <section class="panel io-card">
        <h3>导出匿名统计报告</h3>
        <p>仅导出已结束活动、满足最小样本量的匿名聚合结果，不包含任务、邀请码、评价人关联或审计日志。该文件不能用于系统恢复。</p>
        <el-button type="primary" @click="download">导出匿名统计 JSON</el-button>
        <el-button type="danger" plain @click="downloadFull">导出完整敏感备份</el-button>
      </section>
      <section class="panel io-card">
        <h3>恢复完整备份</h3>
        <p>只接受可恢复的完整备份。系统先进行非破坏性预检，再要求二次确认；匿名统计报告不能导入。</p>
        <input type="file" accept="application/json,.json" @change="choose"/>
        <el-button type="warning" :loading="importing" @click="upload">预检并恢复</el-button>
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
.io-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}.io-card{padding:28px}.io-card h3{margin:0 0 10px}.io-card p{min-height:70px;color:var(--muted);line-height:1.7}.io-card input{display:block;margin:18px 0}.io-card .el-button+.el-button{margin-left:10px}.card-head{display:flex;align-items:center;justify-content:space-between}.log-list{display:grid;gap:8px;max-height:250px;overflow:auto}.log-item{display:grid;gap:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.log-item b{color:var(--ink);font-size:13px}.log-item span{color:var(--muted);font-size:12px}@media(max-width:700px){.io-grid{grid-template-columns:1fr}.io-card .el-button+.el-button{margin:10px 0 0}}
</style>