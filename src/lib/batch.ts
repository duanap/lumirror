import { ElMessage, ElMessageBox } from 'element-plus'
import { api, unwrap } from './api'

function reasonText(reason: unknown) {
  if (reason instanceof Error) return reason.message
  return String(reason || '未知失败原因')
}

export async function showBatchResult<T>(
  results: PromiseSettledResult<unknown>[],
  rows: T[],
  successText: string,
  label: (row: T) => string
) {
  const failures = results
    .map((result, index) => result.status === 'rejected' ? `${label(rows[index])}：${reasonText(result.reason)}` : '')
    .filter(Boolean)
  if (!failures.length) {
    ElMessage.success(successText)
    return
  }
  const successCount = results.length - failures.length
  ElMessage.warning(`已成功 ${successCount} 项，失败 ${failures.length} 项`)
  await ElMessageBox.alert(
    failures.slice(0, 12).join('\n') + (failures.length > 12 ? `\n...另有 ${failures.length - 12} 项失败` : ''),
    '批量操作失败原因',
    { type:'warning', confirmButtonText:'知道了' }
  )
}

type BatchAction = 'status' | 'delete'
type BatchResult = {
  items: Array<{ id: string; success: boolean; message?: string }>
  successCount: number
  failureCount: number
}

export async function runBatchAction<T extends { id: string }>(
  resource: string,
  action: BatchAction,
  rows: T[],
  successText: string,
  label: (row: T) => string,
  extra: Record<string, unknown> = {}
) {
  const data = unwrap<BatchResult>(await api.post('/admin/batch', {
    resource,
    action,
    ids: rows.map((row) => row.id),
    ...extra
  }))
  const rowMap = new Map(rows.map((row) => [row.id, row]))
  const failures = data.items
    .filter((item) => !item.success)
    .map((item) => {
      const row = rowMap.get(item.id)
      return `${row ? label(row) : item.id}：${item.message || '操作失败'}`
    })
  if (!failures.length) {
    ElMessage.success(successText)
    return data
  }
  ElMessage.warning(`已成功 ${data.successCount} 项，失败 ${data.failureCount} 项`)
  await ElMessageBox.alert(
    failures.slice(0, 12).join('\n') + (failures.length > 12 ? `\n...另有 ${failures.length - 12} 项失败` : ''),
    '批量操作失败原因',
    { type:'warning', confirmButtonText:'知道了' }
  )
  return data
}
