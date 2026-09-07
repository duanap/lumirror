import { randomBytes } from 'node:crypto'
import { appendAuditRecord, createAuditRecord } from './audit-repository.mjs'

const DATABASE_KEY = 'employee_review_db_v1'
const DEFAULT_RULES = [
  {id:'ability',name:'工作能力',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'attitude',name:'工作态度',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,operation:'add',enabled:true}
]
const DEFAULT_ROUNDING = 'one_decimal'
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const normalize = (value) => String(value || '').trim()
const uniqueStrings = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => normalize(item)).filter(Boolean))]
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message),{status,code})
const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const copy = (value) => structuredClone(value)

function assertImportArray(data, key, max) {
  if (!Array.isArray(data[key])) throw appError(`导入数据缺少 ${key} 数组`)
  if (data[key].length > max) throw appError(`${key} 数量超过上限 ${max}`,413,'IMPORT_TOO_LARGE')
  for (const item of data[key]) if (!isPlainObject(item) || !normalize(item.id)) throw appError(`${key} 中存在无效记录`)
}

function validateImportData(data) {
  if (!isPlainObject(data)) throw appError('JSON 数据结构无效')
  const limits = {
    departments:1000,teams:1000,employees:5000,memberTags:1000,periods:1000,evaluationCodes:1000,
    verifyCodes:50000,tasks:200000,scores:200000,timedInvites:50000,logs:50000
  }
  for (const [key,max] of Object.entries(limits)) {
    if (data[key] === undefined && ['memberTags','timedInvites','logs'].includes(key)) data[key] = []
    assertImportArray(data,key,max)
  }
  if (data.verifyCodes.some((item) => item.code === '[REDACTED]' || item.codeHash === '[HASH]' || item.codeFingerprint === '[HASH]')) throw appError('当前 JSON 已脱敏，不能作为可恢复数据导入')
  const departmentIds = new Set(data.departments.map((item) => String(item.id)))
  const teamIds = new Set(data.teams.map((item) => String(item.id)))
  const employeeIds = new Set(data.employees.map((item) => String(item.id)))
  const memberTagIds = new Set(data.memberTags.map((item) => String(item.id)))
  const periodIds = new Set(data.periods.map((item) => String(item.id)))
  const evaluationIds = new Set(data.evaluationCodes.map((item) => String(item.id)))
  const verifyIds = new Set(data.verifyCodes.map((item) => String(item.id)))
  if (data.teams.some((item) => item.departmentId && !departmentIds.has(String(item.departmentId)))) throw appError('团队所属部门不存在')
  if (data.employees.some((item) => !teamIds.has(String(item.teamId)) || !departmentIds.has(String(item.departmentId)))) throw appError('成员所属部门或团队不存在')
  if (data.memberTags.some((item) => !normalize(item.name) || normalize(item.name).length > 20)) throw appError('成员标签名称无效')
  if (new Set(data.memberTags.map((item) => normalize(item.name).toLocaleLowerCase('zh-CN'))).size !== data.memberTags.length) throw appError('成员标签名称不能重复')
  if (data.employees.some((item) => uniqueStrings(item.tagIds).some((id) => !memberTagIds.has(id)))) throw appError('成员关联的标签不存在')
  if (data.evaluationCodes.some((item) => !teamIds.has(String(item.teamId)) || !departmentIds.has(String(item.departmentId)) || !periodIds.has(String(item.periodId)))) throw appError('评价活动关联的部门、团队或周期不存在')
  if (data.verifyCodes.some((item) => !evaluationIds.has(String(item.evaluationCodeId)))) throw appError('邀请码关联的评价活动不存在')
  const validTarget = (item) => {
    const targetType = item.targetType === 'team' || item.targetTeamId ? 'team' : 'employee'
    const targetId = String(item.targetId || (targetType === 'team' ? item.targetTeamId : item.targetEmployeeId) || '')
    return targetType === 'team' ? teamIds.has(targetId) : employeeIds.has(targetId)
  }
  if (data.evaluationCodes.some((item) => item.targetType === 'team' && uniqueStrings(item.targetTeamIds).some((id) => !teamIds.has(id)))) throw appError('评价活动关联的目标团队不存在')
  if (data.tasks.some((item) => !evaluationIds.has(String(item.evaluationCodeId)) || !verifyIds.has(String(item.verifyCodeId)) || !validTarget(item))) throw appError('评价任务关联数据不存在')
  if (data.scores.some((item) => !evaluationIds.has(String(item.evaluationCodeId)) || !validTarget(item))) throw appError('评分结果关联数据不存在')
  return data
}

function randomDigits(length) {
  let output = ''
  while (output.length < length) output += String(randomBytes(4).readUInt32BE(0) % 10)
  return output
}

function uniqueLinkCode(database) {
  const used = new Set([
    ...(database.evaluationCodes || []).map((item) => String(item.linkCode || '')),
    ...(database.timedInvites || []).map((item) => String(item.linkCode || ''))
  ].filter(Boolean))
  for (let index = 0; index < 10000; index += 1) {
    const code = randomDigits(8)
    if (!used.has(code)) return code
  }
  throw appError('无法生成唯一邀请链接',500,'CODE_GENERATION_FAILED')
}

function syncVerifyProgress(database, verify) {
  const tasks = database.tasks.filter((task) => task.verifyCodeId === verify.id)
  verify.expected = tasks.length
  verify.submitted = tasks.filter((task) => task.status === 'submitted').length
  verify.remaining = Math.max(0,verify.expected - verify.submitted)
  if (verify.expected > 0 && verify.submitted === verify.expected) {
    verify.status = 'completed'
    verify.completedAt ||= new Date().toISOString()
  } else if (verify.firstUsedAt) {
    verify.status = 'in_progress'
    verify.completedAt = null
  } else {
    verify.status = 'unused'
    verify.completedAt = null
  }
}

function migrateImportDatabase(input, currentUsers) {
  const database = {...copy(input),users:copy(currentUsers),importedAt:new Date().toISOString()}
  const arrays = ['users','admins','departments','teams','employees','memberTags','periods','evaluationCodes','verifyCodes','tasks','scores','timedInvites','logs']
  for (const key of arrays) if (!Array.isArray(database[key])) database[key] = []
  database.admins = []
  database.settings ||= {systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
  const seenTagIds = new Set()
  const seenTagNames = new Set()
  database.memberTags = database.memberTags.filter((tag) => {
    tag.id = normalize(tag.id) || `tag_${randomBytes(8).toString('hex')}`
    tag.name = normalize(tag.name).replace(/\s+/g,' ')
    const key = tag.name.toLocaleLowerCase('zh-CN')
    if (!tag.name || tag.name.length > 20 || seenTagIds.has(tag.id) || seenTagNames.has(key)) return false
    seenTagIds.add(tag.id); seenTagNames.add(key)
    tag.createdAt ||= new Date().toISOString()
    tag.updatedAt ||= tag.createdAt
    return true
  })
  const validTagIds = new Set(database.memberTags.map((tag) => tag.id))
  for (const employee of database.employees) {
    delete employee.employeeNo
    delete employee.phone
    employee.tagIds = uniqueStrings(employee.tagIds).filter((id) => validTagIds.has(id))
  }
  for (const evaluation of database.evaluationCodes) {
    evaluation.rules = Array.isArray(evaluation.rules) && evaluation.rules.length ? evaluation.rules : copy(DEFAULT_RULES)
    evaluation.rules = evaluation.rules.map((rule) => ({...rule,operation:rule.operation === 'subtract' ? 'subtract' : 'add'}))
    evaluation.rounding ||= DEFAULT_ROUNDING
    evaluation.participantMode ||= 'quantity'
    evaluation.excludeSelf = Boolean(evaluation.excludeSelf)
    evaluation.targetType = evaluation.targetType === 'team' ? 'team' : 'employee'
    const teamEmployeeIds = database.employees.filter((employee) => employee.teamId === evaluation.teamId && employee.status === 'active').map((employee) => employee.id)
    if (!Array.isArray(evaluation.targetEmployeeIds)) evaluation.targetEmployeeIds = []
    if (evaluation.targetType === 'employee' && !evaluation.targetEmployeeIds.length) evaluation.targetEmployeeIds = teamEmployeeIds
    if (!Array.isArray(evaluation.targetTeamIds)) evaluation.targetTeamIds = []
    if (!Array.isArray(evaluation.participantEmployeeIds)) evaluation.participantEmployeeIds = []
    evaluation.targetMode ||= 'selected'
    if (!['team','department','custom'].includes(evaluation.employeeTargetScope)) evaluation.employeeTargetScope = evaluation.targetMode === 'selected' ? 'custom' : 'team'
    evaluation.targetTeamId ||= evaluation.teamId
    evaluation.targetDepartmentId ||= evaluation.departmentId
    evaluation.linkCode ||= uniqueLinkCode(database)
  }
  const evaluationById = new Map(database.evaluationCodes.map((evaluation) => [evaluation.id,evaluation]))
  for (const task of database.tasks) {
    const evaluation = evaluationById.get(task.evaluationCodeId)
    task.targetType = task.targetType === 'team' || task.targetTeamId ? 'team' : evaluation?.targetType === 'team' ? 'team' : 'employee'
    task.targetId = String(task.targetId || (task.targetType === 'team' ? task.targetTeamId : task.targetEmployeeId) || '')
    if (task.targetType === 'team') { task.targetTeamId = task.targetId; delete task.targetEmployeeId }
    else { task.targetEmployeeId = task.targetId; delete task.targetTeamId }
  }
  const tasksById = new Map(database.tasks.map((task) => [task.id,task]))
  for (const score of database.scores) {
    const task = tasksById.get(score.taskId)
    score.targetType = score.targetType === 'team' || score.targetTeamId ? 'team' : task?.targetType === 'team' ? 'team' : 'employee'
    score.targetId = String(score.targetId || (score.targetType === 'team' ? score.targetTeamId : score.targetEmployeeId) || task?.targetId || '')
    if (score.targetType === 'team') { score.targetTeamId = score.targetId; delete score.targetEmployeeId }
    else { score.targetEmployeeId = score.targetId; delete score.targetTeamId }
  }
  for (const verify of database.verifyCodes) {
    verify.codeMask = verify.code || verify.codeMask || (verify.suffix ? `****${String(verify.suffix).slice(-2)}` : '******')
    verify.participantEmployeeId ||= ''
    syncVerifyProgress(database,verify)
  }
  for (const invite of database.timedInvites) {
    invite.status ||= 'unused'; invite.createdAt ||= new Date().toISOString(); invite.firstOpenedAt ||= null; invite.expiresAt ||= null; invite.completedAt ||= null
  }
  database.version = 4
  return database
}

function cleanExport(database, {sensitive = false} = {}) {
  const output = copy(database)
  output.users = (output.users || []).map((user) => ({...user,passwordHash:sensitive ? user.passwordHash : '[REDACTED]',salt:sensitive ? user.salt : '[REDACTED]'}))
  if (!sensitive) {
    output.verifyCodes = (output.verifyCodes || []).map((verify) => ({...verify,code:'[REDACTED]',codeMask:'[REDACTED]',suffix:'[REDACTED]',codeHash:'[HASH]',codeFingerprint:'[HASH]',evaluatorHash:'[HASH]'}))
    output.scores = (output.scores || []).map((score) => { const {taskId,createdAt,...anonymous} = score; return anonymous })
  }
  return output
}

export class SqliteMaintenanceRepository {
  constructor(storage) {
    if (!storage?.database || typeof storage.get !== 'function' || typeof storage.put !== 'function') throw new Error('SqliteMaintenanceRepository requires relational storage')
    this.storage = storage
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  async readSnapshot() { return this.storage.get(DATABASE_KEY,{type:'json'}) }

  async exportSanitized() { return cleanExport(await this.readSnapshot(),{sensitive:false}) }

  async exportFull(actor) {
    const createdAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const verifyCodeCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM verification_codes').get().value || 0)
      const scoreCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM scores').get().value || 0)
      appendAuditRecord(this.database,'export.full',{verifyCodeCount,scoreCount},actor,createdAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(createdAt)
      this.database.exec('COMMIT')
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {}; throw cause }
    return cleanExport(await this.readSnapshot(),{sensitive:true})
  }

  async importData(data, actor) {
    const candidate = copy(data)
    validateImportData(candidate)
    const current = await this.readSnapshot()
    const snapshot = migrateImportDatabase(candidate,current.users || [])
    snapshot.logs = Array.isArray(snapshot.logs) ? snapshot.logs : []
    snapshot.logs.push(createAuditRecord('import.json',{employees:snapshot.employees.length,evaluationCodes:snapshot.evaluationCodes.length},actor))
    try {
      await this.storage.put(DATABASE_KEY,snapshot)
    } catch {
      throw appError('KV 写入失败，请检查 KV 命名空间绑定和 Functions 权限',503,'KV_WRITE_FAILED')
    }
    return {imported:true}
  }

  cleanup(actor) {
    const now = new Date()
    const nowText = now.toISOString()
    const retention = this.database.prepare('SELECT log_retention_days FROM settings WHERE singleton=1').get()
    const retentionDays = Math.max(7,Number(retention?.log_retention_days || 90))
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare("UPDATE timed_invites SET status='expired',payload_json=json_set(payload_json,'$.status','expired') WHERE status NOT IN ('completed','expired') AND expires_at IS NOT NULL AND expires_at <= ?").run(nowText)
      const expiredTimedInvites = Number(this.database.prepare("SELECT COUNT(*) AS value FROM timed_invites WHERE status='expired'").get().value || 0)
      const removedLogs = Number(this.database.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff).changes || 0)
      const removedTasks = Number(this.database.prepare("DELETE FROM evaluation_tasks WHERE status != 'submitted' AND NOT EXISTS (SELECT 1 FROM evaluation_activities e WHERE e.id=evaluation_tasks.evaluation_id)").run().changes || 0)
      const result = {expiredTimedInvites,removedLogs,removedTasks}
      appendAuditRecord(this.database,'maintenance.cleanup',result,actor,nowText)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(nowText)
      this.database.exec('COMMIT')
      return result
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {}; throw cause }
  }
}
