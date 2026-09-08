import { createHash } from 'node:crypto'
import { AppError, parseJson, transaction } from './common.mjs'
import { calculateScore } from '../../../shared/scoring.mjs'
import { activityStatus } from '../../domain/activity.mjs'
const hash = (value) => createHash('sha256').update(value).digest('hex')

export class SqlitePublicScoreRepository {
  constructor(storage, scoreRepository) {
    if (!storage?.database || !scoreRepository?.submitAtomic) throw new Error('SqlitePublicScoreRepository requires relational storage and score repository')
    this.database = storage.database
    this.scoreRepository = scoreRepository
  }
  submit(session, input) {
    // Context validation, rule reads, scoring and all writes share one short synchronous transaction.
    return transaction(this.database,() => {
      const now = new Date()
      const evaluation = this.database.prepare('SELECT * FROM evaluation_activities WHERE id=?').get(session.evaluationCodeId)
      const verifyRow = this.database.prepare('SELECT * FROM verification_codes WHERE id=? AND evaluation_id=?').get(session.verifyCodeId,session.evaluationCodeId)
      if (!evaluation || !verifyRow) throw new AppError('评价活动不存在',404,'NOT_FOUND')
      if (activityStatus(evaluation,now.getTime()) !== 'active') throw new AppError('评价活动未开始、已结束或已停用',403,'EVALUATION_INACTIVE')
      if (['locked','disabled'].includes(verifyRow.status)) throw new AppError('邀请码已停用',403,'VERIFY_DISABLED')
      let timedInvite = null
      if (session.timedInviteId) {
        const row = this.database.prepare('SELECT * FROM timed_invites WHERE id=? AND verification_code_id=? AND evaluation_id=?').get(session.timedInviteId,session.verifyCodeId,session.evaluationCodeId)
        const expiresAt = row?.expires_at || parseJson(row?.payload_json).expiresAt
        if (!row || ['completed','expired'].includes(row.status) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) throw new AppError('评价不存在或已结束',403,'EXPIRED')
        timedInvite = {...parseJson(row.payload_json),id:row.id,status:row.status,expiresAt}
      }
      const taskRow = this.database.prepare('SELECT * FROM evaluation_tasks WHERE id=? AND verification_code_id=? AND evaluation_id=?').get(String(input.taskId || ''),session.verifyCodeId,session.evaluationCodeId)
      if (!taskRow) throw new AppError('评价任务不存在',404,'TASK_NOT_FOUND')
      if (taskRow.status !== 'pending' || this.database.prepare('SELECT 1 FROM scores WHERE task_id=?').get(taskRow.id)) throw new AppError('该评价对象已评价，不能重复提交',409,'TASK_ALREADY_SUBMITTED')
      const rules = this.database.prepare('SELECT * FROM evaluation_rules WHERE evaluation_id=? ORDER BY list_order').all(evaluation.id)
        .map((row) => ({id:row.rule_id,name:row.name,min:Number(row.min_value),max:Number(row.max_value),weight:Number(row.weight),operation:row.operation,enabled:Boolean(row.enabled)}))
      const enabled = rules.filter((rule) => rule.enabled)
      const scores = input.scores
      if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw new AppError('评分数据无效',400,'INVALID_SCORES')
      const allowed = new Set(enabled.map((rule) => rule.id))
      if (Object.keys(scores).some((id) => !allowed.has(id))) throw new AppError('评分包含未启用的维度',400,'INVALID_SCORES')
      const values = Object.fromEntries(enabled.map((rule) => [rule.id,scores[rule.id]]))
      const total = calculateScore(values,rules,parseJson(evaluation.payload_json).rounding || 'one_decimal')
      if (total === null) throw new AppError('请为每个维度填写规定范围内的整数',400,'INVALID_SCORES')
      const target = taskRow.target_type === 'team'
        ? this.database.prepare('SELECT t.name,d.name AS departmentName,t.name AS teamName FROM teams t JOIN departments d ON d.id=t.department_id WHERE t.id=?').get(taskRow.target_id)
        : this.database.prepare("SELECT e.name,d.name AS departmentName,t.name AS teamName,json_extract(e.payload_json,'$.position') AS position,json_extract(e.payload_json,'$.gender') AS gender FROM employees e JOIN departments d ON d.id=e.department_id JOIN teams t ON t.id=e.team_id WHERE e.id=?").get(taskRow.target_id)
      if (!target) throw new AppError('评价对象不存在',409,'TARGET_NOT_FOUND')
      const verify = {...parseJson(verifyRow.payload_json),id:verifyRow.id,evaluationCodeId:evaluation.id,status:verifyRow.status}
      const task = {...parseJson(taskRow.payload_json),id:taskRow.id,status:'submitted',submittedAt:now.toISOString()}
      const score = {id:`score_${hash(`${verifyRow.id}:${taskRow.id}`)}`,evaluationCodeId:evaluation.id,taskId:taskRow.id,targetType:taskRow.target_type,targetId:taskRow.target_id,anonymousToken:hash(`${verify.evaluatorHash}:${taskRow.id}`),values,total,createdAt:now.toISOString(),targetSnapshot:{...target}}
      const progress = this.scoreRepository.submitAtomic({evaluationId:evaluation.id,verifyId:verifyRow.id,taskId:taskRow.id,score,task,verify,timedInvite},{transactionOpen:true})
      return {remaining:progress.remaining,completed:progress.completed,total,timed:Boolean(timedInvite),expiresAt:timedInvite?.expiresAt || null}
    })
  }
}
