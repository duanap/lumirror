import { createHash } from 'node:crypto'

const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)
const json = (value) => JSON.stringify(value ?? null)
const appError = (message,status=400,code='BAD_REQUEST') => Object.assign(new Error(message),{status,code})
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

function computeTotal(values,rules,rounding) {
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) return null
  for (const rule of enabled) {
    const value = Number(values[rule.id])
    if (!Number.isInteger(value) || value < rule.min || value > rule.max) return null
  }
  const equalAverage = enabled.every((rule) => (rule.operation || 'add') === 'add' && Number(rule.weight) === 100)
  const netWeight = enabled.reduce((sum,rule) => sum + ((rule.operation || 'add') === 'subtract' ? -1 : 1) * Number(rule.weight),0)
  if (!equalAverage && netWeight !== 100) return null
  const value = equalAverage
    ? enabled.reduce((sum,rule) => sum + Number(values[rule.id]),0) / enabled.length
    : enabled.reduce((sum,rule) => sum + ((rule.operation || 'add') === 'subtract' ? -1 : 1) * Number(values[rule.id]) * Number(rule.weight) / 100,0)
  if (rounding === 'one_decimal') return Math.round(value * 10) / 10
  if (rounding === 'floor') return Math.floor(value)
  return Math.round(value)
}

function activityState(row, nowMs) {
  if (row.status === 'disabled' || row.status === 'archived') return row.status
  const start = new Date(String(row.start_time || '')).getTime()
  const end = new Date(String(row.end_time || '')).getTime()
  if (Number.isFinite(start) && nowMs < start) return 'upcoming'
  if (Number.isFinite(end) && nowMs > end) return 'ended'
  return 'active'
}

export class SqlitePublicScoreRepository {
  constructor(storage, scoreRepository) {
    if (!storage?.database || !scoreRepository?.submitAtomic) throw new Error('SqlitePublicScoreRepository requires relational storage and score repository')
    this.database = storage.database
    this.scoreRepository = scoreRepository
  }

  expireTimedInvite(inviteId, updatedAt) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare("UPDATE timed_invites SET status='expired',payload_json=json_set(payload_json,'$.status','expired') WHERE id=? AND status != 'completed'").run(inviteId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updatedAt)
      this.database.exec('COMMIT')
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {}; throw cause }
  }

  submit(session, input) {
    const now = new Date()
    const nowText = now.toISOString()
    const evaluation = this.database.prepare('SELECT id,status,start_time,end_time,payload_json FROM evaluation_activities WHERE id=?').get(session.evaluationCodeId)
    const verifyRow = this.database.prepare('SELECT id,status,payload_json FROM verification_codes WHERE id=? AND evaluation_id=?').get(session.verifyCodeId,session.evaluationCodeId)
    if (!evaluation || !verifyRow) throw appError('评价活动不存在',404,'NOT_FOUND')
    const state = activityState(evaluation,now.getTime())
    if (state !== 'active') throw appError(state === 'upcoming' ? '该评价活动尚未开始' : state === 'ended' ? '该评价活动已结束' : '该评价活动已停用',403)

    let timedInvite = null
    if (session.timedInviteId) {
      const row = this.database.prepare('SELECT id,verification_code_id,status,expires_at,payload_json FROM timed_invites WHERE id=? AND verification_code_id=? AND evaluation_id=?').get(session.timedInviteId,session.verifyCodeId,session.evaluationCodeId)
      const expiresAt = row?.expires_at || parseJson(row?.payload_json).expiresAt || null
      const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime())
      if (!row || ['completed','expired'].includes(row.status) || expired) {
        if (row && row.status !== 'completed' && expired) this.expireTimedInvite(row.id,nowText)
        throw appError('评价不存在或已结束',403,'EXPIRED')
      }
      timedInvite = {...parseJson(row.payload_json),id:row.id,verifyCodeId:row.verification_code_id,status:row.status,expiresAt}
    }

    const taskRow = this.database.prepare('SELECT id,evaluation_id,verification_code_id,target_type,target_id,status,payload_json FROM evaluation_tasks WHERE id=? AND verification_code_id=? AND evaluation_id=?').get(String(input.taskId || ''),session.verifyCodeId,session.evaluationCodeId)
    if (!taskRow) throw appError('评价任务不存在',404,'TASK_NOT_FOUND')
    if (taskRow.status === 'submitted' || this.database.prepare('SELECT 1 FROM scores WHERE task_id=?').get(taskRow.id)) throw appError('该评价对象已评价，不能重复提交',409,'TASK_ALREADY_SUBMITTED')

    const rules = this.database.prepare('SELECT rule_id,name,min_value,max_value,weight,operation,enabled FROM evaluation_rules WHERE evaluation_id=? ORDER BY list_order').all(evaluation.id).map((rule) => ({id:rule.rule_id,name:rule.name,min:Number(rule.min_value),max:Number(rule.max_value),weight:Number(rule.weight),operation:rule.operation === 'subtract' ? 'subtract' : 'add',enabled:Boolean(rule.enabled)}))
    const values = input.scores && typeof input.scores === 'object' && !Array.isArray(input.scores) ? input.scores : {}
    for (const rule of rules.filter((rule) => rule.enabled)) {
      const value = Number(values[rule.id])
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw appError(`${rule.name}必须是 ${rule.min}-${rule.max} 的整数`)
    }
    const evaluationPayload = parseJson(evaluation.payload_json)
    const total = computeTotal(values,rules,evaluationPayload.rounding || 'one_decimal')
    if (total === null) throw appError('评分数据无效')

    const scoreId = `score_${sha256(`${verifyRow.id}:${taskRow.id}`)}`
    if (this.database.prepare('SELECT 1 FROM scores WHERE id=? OR task_id=?').get(scoreId,taskRow.id)) throw appError('该评价对象已评价，不能重复提交',409,'TASK_ALREADY_SUBMITTED')
    const verify = {...parseJson(verifyRow.payload_json),id:verifyRow.id,evaluationCodeId:evaluation.id,status:verifyRow.status}
    const task = {...parseJson(taskRow.payload_json),id:taskRow.id,evaluationCodeId:evaluation.id,verifyCodeId:verifyRow.id,targetType:taskRow.target_type,targetId:taskRow.target_id,status:'submitted',submittedAt:nowText}
    const progress = this.database.prepare("SELECT COUNT(*) AS expected,SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id=?").get(verifyRow.id)
    const expected = Number(progress.expected || 0)
    const submittedAfter = Number(progress.submitted || 0) + 1
    const remainingAfter = Math.max(0,expected-submittedAfter)
    if (timedInvite && remainingAfter === 0) {
      timedInvite = {...timedInvite,status:'completed',completedAt:timedInvite.completedAt || nowText}
    }
    const score = {
      id:scoreId,evaluationCodeId:evaluation.id,taskId:taskRow.id,targetType:taskRow.target_type,targetId:taskRow.target_id,
      anonymousToken:sha256(`${verify.evaluatorHash}:${taskRow.id}`),values:structuredClone(values),total,createdAt:nowText
    }
    try {
      this.scoreRepository.submitAtomic({evaluationId:evaluation.id,verifyId:verifyRow.id,taskId:taskRow.id,score,task,verify,timedInvite})
    } catch (error) {
      if (error?.code === 'TASK_ALREADY_SUBMITTED') throw appError('该评价对象已评价，不能重复提交',409,error.code)
      throw error
    }
    return {remaining:remainingAfter,completed:remainingAfter === 0,total,timed:Boolean(timedInvite),expiresAt:timedInvite?.expiresAt || null}
  }
}
