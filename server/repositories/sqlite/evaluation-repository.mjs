import { SqliteScoreRepository } from './score-repository.mjs'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })
const now = () => new Date().toISOString()

export class SqliteEvaluationRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteEvaluationRepository requires relational storage')
    this.database = storage.database
    this.scoreRepository = new SqliteScoreRepository(storage)
  }

  findUser(userId) {
    return this.scoreRepository.findUser(userId)
  }

  canAccess(row, session) {
    if (!row || session.role === 'member') return false
    if (session.role === 'admin') return true
    if (session.role === 'team_leader') return row.team_id === session.teamId
    if (session.role === 'leader') return row.department_id === session.departmentId
    return false
  }

  canWrite(row, session) {
    return session.role === 'admin' || (session.role === 'team_leader' && row?.team_id === session.teamId)
  }

  list(session) {
    const rows = this.scoreRepository.visibleEvaluationRows(session)
    return {
      items:rows.map((row) => {
        const view = this.scoreRepository.evaluationView(row)
        return {...view,status:this.activityStatus(view)}
      }).sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
      canWrite:session.role === 'admin' || session.role === 'team_leader'
    }
  }

  activityStatus(evaluation) {
    if (evaluation.status === 'disabled' || evaluation.status === 'archived') return evaluation.status
    const nowMs = Date.now()
    const start = new Date(String(evaluation.startTime || '')).getTime()
    const end = new Date(String(evaluation.endTime || '')).getTime()
    if (Number.isFinite(start) && nowMs < start) return 'upcoming'
    if (Number.isFinite(end) && nowMs > end) return 'ended'
    return 'active'
  }

  update(evaluationId, input, session) {
    const row = this.database.prepare('SELECT * FROM evaluation_activities WHERE id = ?').get(evaluationId)
    if (!this.canAccess(row,session) || !this.canWrite(row,session)) throw appError('评价活动不存在或无权编辑',404,'NOT_FOUND')
    const previous = parseJson(row.payload_json)
    const requestedStatus = input.status
    if (row.status === 'archived' && !(requestedStatus === 'active' && Object.keys(input).every((key) => key === 'status'))) throw appError('已归档活动为只读状态，只能恢复归档',409,'EVALUATION_ARCHIVED')
    if (requestedStatus === 'archived' && Object.keys(input).some((key) => key !== 'status')) throw appError('归档活动时不能同时修改其他字段')
    if (requestedStatus !== undefined && !['active','disabled','archived'].includes(requestedStatus)) throw appError('活动状态无效')
    const nextStart = input.startTime ?? row.start_time
    const nextEnd = input.endTime ?? row.end_time
    if (new Date(nextStart).getTime() >= new Date(nextEnd).getTime()) throw appError('开始时间和结束时间无效')
    if (input.startTime !== undefined || input.endTime !== undefined) {
      const period = this.database.prepare('SELECT start_time, end_time FROM review_periods WHERE id = ?').get(row.period_id)
      if (!period || new Date(nextStart).getTime() < new Date(period.start_time).getTime() || new Date(nextEnd).getTime() > new Date(period.end_time).getTime()) throw appError('评价活动时间必须处于所属周期时间范围内')
    }
    const previousStatus = row.status
    if (requestedStatus === 'archived' && previousStatus !== 'archived' && this.activityStatus({...previous,startTime:row.start_time,endTime:row.end_time,status:row.status}) !== 'ended') throw appError('只有已经结束的评价活动可以归档',409,'EVALUATION_NOT_ENDED')
    if (previousStatus === 'archived' && requestedStatus !== 'active') throw appError('已归档活动只能先恢复归档',409,'EVALUATION_ARCHIVED')
    const nextStatus = requestedStatus ?? row.status
    const next = {...previous,name:input.name !== undefined ? String(input.name).trim() || previous.name : row.name,status:nextStatus,startTime:nextStart,endTime:nextEnd,updatedAt:now()}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE evaluation_activities SET name = ?, status = ?, start_time = ?, end_time = ?, payload_json = ? WHERE id = ?')
        .run(next.name,next.status,next.startTime,next.endTime,json(next),evaluationId)
      if (previousStatus !== nextStatus && (nextStatus === 'archived' || previousStatus === 'archived')) {
        const action = nextStatus === 'archived' ? 'evaluation.archive' : 'evaluation.unarchive'
        this.appendAudit(action,{evaluationId,name:next.name},next.updatedAt)
      }
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(next.updatedAt)
      this.database.exec('COMMIT')
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
    const updated = this.database.prepare('SELECT e.id, e.code, e.link_code, e.name, e.period_id, e.department_id, e.team_id, e.status, e.start_time, e.end_time, e.payload_json, e.list_order, t.name AS team_name, d.name AS department_name, p.name AS period_name FROM evaluation_activities e JOIN teams t ON t.id = e.team_id JOIN departments d ON d.id = e.department_id LEFT JOIN review_periods p ON p.id = e.period_id WHERE e.id = ?').get(evaluationId)
    const view = this.scoreRepository.evaluationView(updated)
    return {...view,status:this.activityStatus(view),lifecycleStatus:view.status}
  }

  delete(evaluationId, session) {
    const row = this.database.prepare('SELECT * FROM evaluation_activities WHERE id = ?').get(evaluationId)
    if (!this.canAccess(row,session) || !this.canWrite(row,session)) throw appError('评价活动不存在或无权删除',404,'NOT_FOUND')
    if (row.status === 'archived') throw appError('已归档活动为只读状态，不能删除',409,'EVALUATION_ARCHIVED')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM evaluation_activities WHERE id = ?').run(evaluationId)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(now())
      this.database.exec('COMMIT')
      return {deleted:true}
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  appendAudit(action, detail, createdAt) {
    const id = `audit_${action.replace(/[^a-z0-9]+/gi,'_')}_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const payload = {id,action,actorId:'',actorName:'',role:'',detail,createdAt}
    const listOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM audit_logs').get().value)
    this.database.prepare('INSERT INTO audit_logs (id, action, actor_id, role, created_at, detail_json, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id,action,null,null,createdAt,json(detail),json(payload),listOrder)
  }
}
