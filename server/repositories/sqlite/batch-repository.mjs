import { appendAuditRecord } from './audit-repository.mjs'
import { AppError } from './common.mjs'
import { normalizeError } from '../../http/errors.mjs'

const normalize = (value) => String(value || '').trim()
export class SqliteBatchRepository {
  constructor({storage,employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository}) {
    this.database = storage.database
    Object.assign(this,{employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository})
  }
  findUser(id) { return this.userRepository.findUser(id) }
  setUserStatus(id,status,session) { return this.userRepository.setStatus(id,status,session) }
  run(session,input) {
    const resource = normalize(input.resource), action = normalize(input.action), status = normalize(input.status)
    const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(normalize).filter(Boolean))]
    if (!ids.length || ids.length > 200) throw new AppError('单次批量操作需选择 1-200 条记录')
    if (action === 'status' && !(resource === 'evaluation-codes' ? ['active','disabled','archived'] : ['active','inactive']).includes(status)) throw new AppError('批量状态无效')
    const admin = (callback) => {
      if (session.role !== 'admin') throw new AppError('当前账号没有此操作权限',403,'FORBIDDEN')
      return callback()
    }
    const runners = {
      employees:{status:(id) => this.employeeRepository.update(id,{status},session),delete:(id) => this.employeeRepository.delete(id,session)},
      users:{status:(id) => this.setUserStatus(id,status,session),delete:(id) => admin(() => this.userRepository.delete(id,session.userId,{audit:false}))},
      departments:{status:(id) => this.organizationRepository.update('departments',id,{status},session),delete:(id) => this.organizationRepository.delete('departments',id,session)},
      teams:{status:(id) => this.organizationRepository.update('teams',id,{status},session),delete:(id) => this.organizationRepository.delete('teams',id,session)},
      periods:{status:(id) => admin(() => this.periodRepository.update(id,{status})),delete:(id) => admin(() => this.periodRepository.delete(id))},
      'evaluation-codes':{status:(id) => this.evaluationRepository.update(id,{status},session),delete:(id) => this.evaluationRepository.delete(id,session)},
      'verify-codes':{delete:(id) => this.taskRepository.deleteVerifyCode(id,session)},
      tasks:{delete:(id) => this.taskRepository.deleteTask(id,session)}
    }
    if (!Object.hasOwn(runners,resource) || !Object.hasOwn(runners[resource],action)) throw new AppError('不支持的批量操作')
    const items = ids.map((id) => {
      try {
        const result = runners[resource][action](id)
        if (result && typeof result.then === 'function') throw new Error('Batch mutation must be synchronous')
        return {id,success:true}
      } catch (error) {
        const normalized = normalizeError(error)
        if (normalized.status >= 500) throw error
        return {id,success:false,message:normalized.message,code:normalized.code}
      }
    })
    const successCount = items.filter((item) => item.success).length
    const result = {items,successCount,failureCount:items.length-successCount}
    if (successCount) appendAuditRecord(this.database,'batch.operation',{resource,action,successCount,failureCount:result.failureCount},session)
    return result
  }
}
