import { appendAuditRecord } from './audit-repository.mjs'
import { currentAuditActor } from '../../request-context.mjs'
import { AppError, parseJson, transaction, touch } from './common.mjs'
import { activityStatus } from '../../domain/activity.mjs'
import { ROUNDING_MODES } from '../../../shared/scoring.mjs'
import { prepareScoreRules } from '../../domain/score-rules.mjs'

export class SqliteSettingsRepository {
  constructor(storage) { if (!storage?.database) throw new Error('SqliteSettingsRepository requires relational storage'); this.database = storage.database }
  findUser(id) {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(id)
    return row ? {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''} : null
  }
  get() {
    const row = this.database.prepare('SELECT * FROM settings WHERE singleton=1').get()
    return {systemName:row?.system_name || '和光镜鉴',publicSessionMinutes:Number(row?.public_session_minutes || 120),logRetentionDays:Number(row?.log_retention_days || 90)}
  }
  update(input) {
    return transaction(this.database,() => {
      const next = this.get()
      if (input.systemName !== undefined) { next.systemName = String(input.systemName || '').trim(); if (!next.systemName || next.systemName.length > 40) throw new AppError('系统名称需为 1-40 个字符') }
      if (input.publicSessionMinutes !== undefined) { next.publicSessionMinutes = Number(input.publicSessionMinutes); if (!Number.isInteger(next.publicSessionMinutes) || next.publicSessionMinutes < 5 || next.publicSessionMinutes > 240) throw new AppError('普通评价会话时长需为 5-240 分钟') }
      if (input.logRetentionDays !== undefined) { next.logRetentionDays = Number(input.logRetentionDays); if (!Number.isInteger(next.logRetentionDays) || next.logRetentionDays < 7 || next.logRetentionDays > 3650) throw new AppError('日志保留天数需为 7-3650 天') }
      const now = new Date().toISOString()
      this.database.prepare('UPDATE settings SET system_name=?,public_session_minutes=?,log_retention_days=? WHERE singleton=1').run(next.systemName,next.publicSessionMinutes,next.logRetentionDays)
      appendAuditRecord(this.database,'settings.update',{keys:Object.keys(input).filter((key) => ['systemName','publicSessionMinutes','logRetentionDays'].includes(key))},currentAuditActor() || {},now)
      touch(this.database,now)
      return next
    })
  }
  visibleEvaluations(session = currentAuditActor()) {
    if (!session || !['admin','team_leader'].includes(session.role)) return []
    return this.database.prepare(`SELECT e.*,t.name AS team_name FROM evaluation_activities e LEFT JOIN teams t ON t.id=e.team_id${session.role === 'team_leader' ? ' WHERE e.team_id=?' : ''} ORDER BY e.list_order`).all(...(session.role === 'team_leader' ? [session.teamId] : []))
  }
  scoreRules(id, session = currentAuditActor()) {
    const available = this.visibleEvaluations(session)
    const selected = available.find((row) => row.id === id) || available.find((row) => activityStatus(row) === 'active') || available.at(-1)
    if (!selected) throw new AppError('暂无评价活动',404,'NOT_FOUND')
    const rules = this.database.prepare('SELECT payload_json FROM evaluation_rules WHERE evaluation_id=? ORDER BY list_order').all(selected.id).map((row) => parseJson(row.payload_json))
    const locked = selected.status === 'archived' || Boolean(this.database.prepare('SELECT 1 FROM scores WHERE evaluation_id=? LIMIT 1').get(selected.id))
    const periods = this.database.prepare('SELECT * FROM review_periods ORDER BY list_order').all().map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,status:row.status,startTime:row.start_time,endTime:row.end_time}))
    return {
      evaluation:{id:selected.id,name:selected.name,periodId:selected.period_id,status:activityStatus(selected)},rules,
      rounding:parseJson(selected.payload_json).rounding || 'one_decimal',locked,
      lockedReason:locked ? '已收到评分或已归档，计分规则不可修改；请新建活动使用新规则' : '',
      activities:available.map((row) => ({id:row.id,name:row.name,periodId:row.period_id,status:activityStatus(row),teamName:row.team_name || ''})),periods
    }
  }
  updateScoreRules(id, input, session = currentAuditActor()) {
    if (!session || !['admin','team_leader'].includes(session.role)) throw new AppError('当前账号没有修改评分规则权限',403,'FORBIDDEN')
    const rules = prepareScoreRules(input.rules || [])
    const rounding = input.rounding || 'one_decimal'
    if (!ROUNDING_MODES.includes(rounding)) throw new AppError('评分取整方式无效')
    return transaction(this.database,() => {
      const row = this.visibleEvaluations(session).find((item) => item.id === id)
      if (!row) throw new AppError('评价活动不存在或无权操作',404,'NOT_FOUND')
      if (row.status === 'archived') throw new AppError('已归档活动为只读状态',409,'EVALUATION_ARCHIVED')
      if (this.database.prepare('SELECT 1 FROM scores WHERE evaluation_id=? LIMIT 1').get(id)) throw new AppError('活动已收到评分，不能更改计分规则',409,'SCORE_RULES_LOCKED')
      this.database.prepare('DELETE FROM evaluation_rules WHERE evaluation_id=?').run(id)
      const insert = this.database.prepare('INSERT INTO evaluation_rules (evaluation_id,rule_id,name,min_value,max_value,weight,operation,enabled,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      rules.forEach((rule,index) => insert.run(id,rule.id,rule.name,rule.min,rule.max,rule.weight,rule.operation,rule.enabled ? 1 : 0,JSON.stringify(rule),index))
      const now = new Date().toISOString()
      this.database.prepare("UPDATE evaluation_activities SET payload_json=json_set(payload_json,'$.rounding',?,'$.updatedAt',?) WHERE id=?").run(rounding,now,id)
      appendAuditRecord(this.database,'score_rules.update',{evaluationId:id},session,now)
      touch(this.database,now)
      return {saved:true}
    })
  }
}
