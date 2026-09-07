import { appendAuditRecord } from './audit-repository.mjs'
import { currentAuditActor } from '../../request-context.mjs'

const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })
const DEFAULT_ROUNDING = 'one_decimal'

function activityStatus(row) {
  if (row.status === 'disabled' || row.status === 'archived') return row.status
  const now = Date.now()
  const start = new Date(String(row.start_time || '')).getTime()
  const end = new Date(String(row.end_time || '')).getTime()
  if (Number.isFinite(start) && now < start) return 'upcoming'
  if (Number.isFinite(end) && now > end) return 'ended'
  return 'active'
}

function prepareScoreRules(inputRules) {
  if (!Array.isArray(inputRules) || inputRules.length < 1 || inputRules.length > 12) throw appError('评分维度数量必须为 1-12 个')
  const rules = inputRules.map((item,index) => ({
    id:String(item.id || '').trim() || `dimension_${index + 1}`,
    name:String(item.name || '').trim(),
    min:Number(item.min),
    max:Number(item.max),
    weight:Number(item.weight),
    operation:item.operation === 'subtract' ? 'subtract' : 'add',
    enabled:Boolean(item.enabled)
  }))
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length || rules.some((rule) => !/^[A-Za-z0-9_-]{1,48}$/.test(rule.id))) throw appError('评分维度标识无效或重复')
  if (rules.some((rule) => !rule.name || rule.name.length > 30)) throw appError('评分维度名称不能为空且不能超过 30 个字符')
  if (rules.some((rule) => !Number.isInteger(rule.min) || !Number.isInteger(rule.max) || rule.min < 0 || rule.max > 99 || rule.min >= rule.max)) throw appError('评分范围必须是 0-99 内递增的整数')
  if (rules.some((rule) => !Number.isInteger(rule.weight) || rule.weight < 0 || rule.weight > 100)) throw appError('计入比例必须是 0-100 的整数')
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) throw appError('至少启用 1 个评分维度')
  const equalAverage = enabled.every((rule) => rule.operation === 'add' && rule.weight === 100)
  const netWeight = enabled.reduce((sum,rule) => sum + (rule.operation === 'subtract' ? -1 : 1) * rule.weight,0)
  if (!equalAverage && netWeight !== 100) throw appError('启用维度的净计入比例必须为 100%，或全部使用 100% 等权平均')
  return rules
}

export class SqliteSettingsRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteSettingsRepository requires relational storage')
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  get() {
    const row = this.database.prepare('SELECT system_name,public_session_minutes,log_retention_days FROM settings WHERE singleton=1').get()
    return {systemName:row?.system_name || '和光镜鉴',publicSessionMinutes:Number(row?.public_session_minutes || 120),logRetentionDays:Number(row?.log_retention_days || 90)}
  }

  update(input) {
    const current = this.get()
    const next = {...current}
    if (input.systemName !== undefined) { next.systemName = String(input.systemName || '').trim(); if (!next.systemName || next.systemName.length > 40) throw appError('系统名称需为 1-40 个字符') }
    if (input.publicSessionMinutes !== undefined) { next.publicSessionMinutes = Number(input.publicSessionMinutes); if (!Number.isInteger(next.publicSessionMinutes) || next.publicSessionMinutes < 5 || next.publicSessionMinutes > 240) throw appError('普通评价会话时长需为 5-240 分钟') }
    if (input.logRetentionDays !== undefined) { next.logRetentionDays = Number(input.logRetentionDays); if (!Number.isInteger(next.logRetentionDays) || next.logRetentionDays < 7 || next.logRetentionDays > 3650) throw appError('日志保留天数需为 7-3650 天') }
    const changedKeys = Object.keys(input || {}).filter((key) => ['systemName','publicSessionMinutes','logRetentionDays'].includes(key))
    const updatedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE settings SET system_name=?,public_session_minutes=?,log_retention_days=? WHERE singleton=1').run(next.systemName,next.publicSessionMinutes,next.logRetentionDays)
      appendAuditRecord(this.database,'settings.update',{keys:changedKeys},currentAuditActor(),updatedAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updatedAt)
      this.database.exec('COMMIT')
      return next
    }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  visibleEvaluations(session = currentAuditActor()) {
    if (!session || !['admin','team_leader'].includes(session.role)) return []
    const scope = session.role === 'team_leader' ? ' WHERE e.team_id=?' : ''
    const params = session.role === 'team_leader' ? [session.teamId] : []
    return this.database.prepare(`
      SELECT e.id,e.name,e.period_id,e.status,e.start_time,e.end_time,e.team_id,e.payload_json,e.list_order,t.name AS team_name
      FROM evaluation_activities e LEFT JOIN teams t ON t.id=e.team_id${scope} ORDER BY e.list_order
    `).all(...params)
  }

  scoreRules(evaluationId, session = currentAuditActor()) {
    const available = this.visibleEvaluations(session)
    const selected = available.find((row) => row.id === evaluationId)
      || available.find((row) => activityStatus(row) === 'active')
      || available.at(-1)
    if (!selected) throw appError('暂无评价活动',404,'NOT_FOUND')
    const evaluation = parseJson(selected.payload_json)
    const rules = this.database.prepare('SELECT payload_json FROM evaluation_rules WHERE evaluation_id=? ORDER BY list_order').all(selected.id).map((item) => parseJson(item.payload_json))
    const periods = this.database.prepare('SELECT id,name,status,start_time,end_time,payload_json FROM review_periods ORDER BY list_order').all().map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,status:row.status,startTime:row.start_time,endTime:row.end_time}))
    return {
      evaluation:{id:selected.id,name:selected.name,periodId:selected.period_id,status:activityStatus(selected)},
      rules,
      rounding:evaluation.rounding || DEFAULT_ROUNDING,
      activities:available.map((row) => ({id:row.id,name:row.name,periodId:row.period_id,status:activityStatus(row),teamName:row.team_name || ''})),
      periods
    }
  }

  updateScoreRules(evaluationId, input, session = currentAuditActor()) {
    if (!session || !['admin','team_leader'].includes(session.role)) throw appError('当前账号没有修改评分规则权限',403,'FORBIDDEN')
    const row = this.visibleEvaluations(session).find((item) => item.id === evaluationId)
    if (!row) throw appError('评价活动不存在或无权操作',404,'NOT_FOUND')
    if (row.status === 'archived') throw appError('已归档活动为只读状态，不能修改评分规则',409,'EVALUATION_ARCHIVED')
    const rules = prepareScoreRules(input.rules || [])
    const rounding = input.rounding || DEFAULT_ROUNDING
    const updatedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM evaluation_rules WHERE evaluation_id=?').run(evaluationId)
      const insert = this.database.prepare('INSERT INTO evaluation_rules (evaluation_id,rule_id,name,min_value,max_value,weight,operation,enabled,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      rules.forEach((rule,index) => insert.run(evaluationId,rule.id,rule.name,rule.min,rule.max,rule.weight,rule.operation,rule.enabled ? 1 : 0,JSON.stringify(rule),index))
      this.database.prepare("UPDATE evaluation_activities SET payload_json=json_set(payload_json,'$.rounding',?,'$.updatedAt',?) WHERE id=?").run(rounding,updatedAt,evaluationId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updatedAt)
      this.database.exec('COMMIT')
      return {saved:true}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }
}
