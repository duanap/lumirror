import { appendAuditRecord } from './audit-repository.mjs'
import { currentAuditActor } from '../../request-context.mjs'

const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })

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

  scoreRules(evaluationId) {
    const row = this.database.prepare('SELECT id,name,period_id,status,payload_json FROM evaluation_activities WHERE id=?').get(evaluationId)
    if (!row) throw appError('暂无评价活动',404,'NOT_FOUND')
    const evaluation = parseJson(row.payload_json)
    const rules = this.database.prepare('SELECT payload_json FROM evaluation_rules WHERE evaluation_id=? ORDER BY list_order').all(evaluationId).map((item) => parseJson(item.payload_json))
    return {evaluation:{id:row.id,name:row.name,periodId:row.period_id,status:row.status},rules,rounding:evaluation.rounding || 'one_decimal'}
  }

  updateScoreRules(evaluationId, input) {
    const current = this.scoreRules(evaluationId)
    if (current.evaluation.status === 'archived') throw appError('已归档活动为只读状态，不能修改评分规则',409,'EVALUATION_ARCHIVED')
    const rules = Array.isArray(input.rules) ? input.rules : []
    const rounding = input.rounding || current.rounding
    if (!rules.length || rules.length > 12) throw appError('评分维度数量必须为 1-12 个')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM evaluation_rules WHERE evaluation_id=?').run(evaluationId)
      const insert = this.database.prepare('INSERT INTO evaluation_rules (evaluation_id,rule_id,name,min_value,max_value,weight,operation,enabled,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      rules.forEach((rule,index) => insert.run(evaluationId,rule.id,rule.name,Number(rule.min),Number(rule.max),Number(rule.weight),rule.operation === 'subtract' ? 'subtract' : 'add',rule.enabled ? 1 : 0,JSON.stringify({...rule,operation:rule.operation === 'subtract' ? 'subtract' : 'add'}),index))
      this.database.prepare('UPDATE evaluation_activities SET payload_json=json_set(payload_json,\'$.rounding\',?) WHERE id=?').run(rounding,evaluationId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return {saved:true}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }
}
