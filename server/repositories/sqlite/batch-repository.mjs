import { appendAuditRecord } from './audit-repository.mjs'

const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message),{status,code})
const normalize = (value) => String(value || '').trim()
const uniqueStrings = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))]

export class SqliteBatchRepository {
  constructor({storage,employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository}) {
    if (!storage?.database) throw new Error('SqliteBatchRepository requires relational storage')
    this.database = storage.database
    this.employeeRepository = employeeRepository
    this.userRepository = userRepository
    this.organizationRepository = organizationRepository
    this.periodRepository = periodRepository
    this.evaluationRepository = evaluationRepository
    this.taskRepository = taskRepository
  }

  findUser(userId) { return this.userRepository.findUser(userId) }

  setUserStatus(userId, status, session) {
    if (session.role !== 'admin') throw appError('当前账号没有此操作权限',403,'FORBIDDEN')
    if (!['active','inactive'].includes(status)) throw appError('账号状态无效')
    const row = this.database.prepare('SELECT id,role,status,payload_json FROM users WHERE id=?').get(userId)
    if (!row) throw appError('账号不存在',404,'NOT_FOUND')
    if (userId === session.userId && status === 'inactive') throw appError('不能停用当前登录账号',409)
    const activeAdmins = Number(this.database.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active' AND id != ?").get(userId).value || 0) + (row.role === 'admin' && status === 'active' ? 1 : 0)
    if (activeAdmins < 1) throw appError('系统必须保留至少一个启用管理员',409)
    const now = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare("UPDATE users SET status=?,payload_json=json_set(payload_json,'$.status',?,'$.updatedAt',?) WHERE id=?").run(status,status,now,userId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(now)
      this.database.exec('COMMIT')
      return {updated:true}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {}; throw cause }
  }

  run(session, input) {
    const resource = normalize(input.resource)
    const action = normalize(input.action)
    const status = normalize(input.status)
    const ids = uniqueStrings(input.ids)
    if (!ids.length) throw appError('请选择要批量操作的数据')
    if (ids.length > 200) throw appError('单次批量操作最多 200 条')
    if (action === 'status') {
      if (resource === 'evaluation-codes') {
        if (!['active','disabled','archived'].includes(status)) throw appError('活动状态无效')
      } else if (!['active','inactive'].includes(status)) {
        const labels = {employees:'成员',users:'账号',departments:'组织',teams:'组织',periods:'评价周期'}
        throw appError(`${labels[resource] || '记录'}状态无效`)
      }
    }

    const runners = {
      employees:{
        status:(id) => this.employeeRepository.update(id,{status},session),
        delete:(id) => this.employeeRepository.delete(id,session)
      },
      users:{
        status:(id) => this.setUserStatus(id,status,session),
        delete:(id) => { if (session.role !== 'admin') throw appError('当前账号没有此操作权限',403,'FORBIDDEN'); return this.userRepository.delete(id,session.userId) }
      },
      departments:{
        status:(id) => this.organizationRepository.update('departments',id,{status},session),
        delete:(id) => this.organizationRepository.delete('departments',id,session)
      },
      teams:{
        status:(id) => this.organizationRepository.update('teams',id,{status},session),
        delete:(id) => this.organizationRepository.delete('teams',id,session)
      },
      periods:{
        status:(id) => { if (session.role !== 'admin') throw appError('只有管理员可以编辑评价周期',403,'FORBIDDEN'); return this.periodRepository.update(id,{status}) },
        delete:(id) => { if (session.role !== 'admin') throw appError('只有管理员可以删除评价周期',403,'FORBIDDEN'); return this.periodRepository.delete(id) }
      },
      'evaluation-codes':{
        status:(id) => this.evaluationRepository.update(id,{status},session),
        delete:(id) => this.evaluationRepository.delete(id,session)
      },
      'verify-codes':{
        delete:(id) => this.taskRepository.deleteVerifyCode(id,session)
      },
      tasks:{
        delete:(id) => this.taskRepository.deleteTask(id,session)
      }
    }
    if (!runners[resource]) throw appError('批量资源类型无效')
    if (!runners[resource][action]) throw appError('该资源不支持当前批量操作')
    const items = ids.map((id) => {
      try { runners[resource][action](id); return {id,success:true} }
      catch (error) { return {id,success:false,message:String(error?.message || '操作失败')} }
    })
    const successCount = items.filter((item) => item.success).length
    const result = {items,successCount,failureCount:items.length-successCount}
    if (successCount > 0) appendAuditRecord(this.database,'batch.operation',{resource,action,successCount,failureCount:result.failureCount},session)
    return result
  }
}
