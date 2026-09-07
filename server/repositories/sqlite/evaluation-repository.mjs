import { randomBytes, createHash } from 'node:crypto'
import { SqliteScoreRepository } from './score-repository.mjs'
import { appendAuditRecord } from './audit-repository.mjs'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })
const now = () => new Date().toISOString()
const randomId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const DEFAULT_RULES = [
  {id:'ability',name:'工作能力',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'attitude',name:'工作态度',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,operation:'add',enabled:true}
]

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
        this.appendAudit(action,{evaluationId,name:next.name},session,next.updatedAt)
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

  createActivity(input, session) {
    if (session.role !== 'admin' && session.role !== 'team_leader') throw appError('当前账号没有此操作权限',403,'FORBIDDEN')
    const team = this.database.prepare('SELECT id, name, department_id, status FROM teams WHERE id = ?').get(input.teamId)
    if (!team || team.status === 'inactive' || (session.role === 'team_leader' && session.teamId !== team.id)) throw appError('请选择有权限管理的有效团队')
    const name = String(input.name || '').trim()
    const startTime = input.startTime
    const endTime = input.endTime
    if (!name) throw appError('评价活动名称不能为空')
    if (!startTime || !endTime || new Date(startTime).getTime() >= new Date(endTime).getTime()) throw appError('开始时间和结束时间无效')

    const visibleTeams = this.database.prepare(`
      SELECT id, department_id, name FROM teams WHERE status = 'active' AND (? = 'admin' OR (? = 'team_leader' AND id = ?) OR (? = 'leader' AND department_id = ?))
    `).all(session.role,session.role,session.teamId,session.role,session.departmentId)
    const visibleTeamIds = new Set(visibleTeams.map((row) => row.id))
    const visibleEmployees = this.database.prepare(`
      SELECT id, name, team_id, department_id, status FROM employees WHERE status = 'active'
    `).all().filter((row) => visibleTeamIds.has(row.team_id))
    const visibleEmployeeIds = new Set(visibleEmployees.map((row) => row.id))
    const teamEmployees = visibleEmployees.filter((row) => row.team_id === team.id)
    const teamEmployeeIds = new Set(teamEmployees.map((row) => row.id))
    const targetType = input.targetType === 'team' ? 'team' : 'employee'
    const targetMode = input.targetMode === 'selected' ? 'selected' : 'all'
    const requestedScope = ['team','department','custom'].includes(input.employeeTargetScope) ? input.employeeTargetScope : null
    const employeeTargetScope = requestedScope || (targetMode === 'selected' ? 'custom' : 'team')
    const targetTeamId = String(input.targetTeamId || team.id)
    const targetDepartmentId = String(input.targetDepartmentId || team.department_id)
    let targetEmployeeIds = []
    if (targetType === 'employee' && employeeTargetScope === 'team') {
      if (!visibleTeamIds.has(targetTeamId)) throw appError('请选择有权限访问的有效目标团队')
      targetEmployeeIds = visibleEmployees.filter((employee) => employee.team_id === targetTeamId).map((employee) => employee.id)
    } else if (targetType === 'employee' && employeeTargetScope === 'department') {
      const departmentTeams = new Set(visibleTeams.filter((item) => item.department_id === targetDepartmentId).map((item) => item.id))
      if (!departmentTeams.size) throw appError('请选择有权限访问的有效目标部门')
      targetEmployeeIds = visibleEmployees.filter((employee) => departmentTeams.has(employee.team_id)).map((employee) => employee.id)
    } else if (targetType === 'employee') {
      targetEmployeeIds = [...new Set((Array.isArray(input.targetEmployeeIds) ? input.targetEmployeeIds : []).map(String).filter((id) => visibleEmployeeIds.has(id)))]
      if (!requestedScope) targetEmployeeIds = targetEmployeeIds.filter((id) => teamEmployeeIds.has(id))
    }
    const targetTeamIds = targetType === 'team'
      ? (targetMode === 'selected' ? [...new Set((Array.isArray(input.targetTeamIds) ? input.targetTeamIds : []).map(String).filter((id) => visibleTeamIds.has(id)))] : [...visibleTeamIds])
      : []
    if (!(targetType === 'team' ? targetTeamIds : targetEmployeeIds).length) throw appError('至少选择 1 个评价对象')

    const participantMode = input.participantMode === 'selected' ? 'selected' : 'quantity'
    const participantEmployeeIds = participantMode === 'selected'
      ? [...new Set((Array.isArray(input.participantEmployeeIds) ? input.participantEmployeeIds : []).map(String).filter((id) => teamEmployeeIds.has(id)))]
      : []
    const participantCount = participantMode === 'selected' ? participantEmployeeIds.length : Number(input.participantCount)
    if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 200) throw appError('邀请码数量必须是 1-200 的整数')

    const periodMode = input.periodMode === 'existing' ? 'existing' : 'new'
    let period = periodMode === 'existing' ? this.database.prepare('SELECT payload_json FROM review_periods WHERE id = ? AND status != ?').get(input.periodId,'inactive') : null
    if (periodMode === 'existing' && !period) throw appError('请选择有效的评价周期')
    period = period ? parseJson(period.payload_json) : null
    if (period && new Date(period.endTime).getTime() < Date.now()) throw appError('所选评价周期已结束，请选择其他周期')
    if (period && (new Date(startTime).getTime() < new Date(period.startTime).getTime() || new Date(endTime).getTime() > new Date(period.endTime).getTime())) throw appError('评价活动时间必须处于所选评价周期时间范围内')
    const createdAt = now()
    if (!period) period = {id:randomId('period'),name:String(input.periodName || '').trim() || `${name}周期`,startTime,endTime,status:'active',anonymous:true,allowRepeat:false,allowModify:false,createdAt,updatedAt:createdAt}

    const rawRules = Array.isArray(input.rules) && input.rules.length ? input.rules : DEFAULT_RULES
    if (!Array.isArray(rawRules) || rawRules.length < 1 || rawRules.length > 12) throw appError('评分维度数量必须为 1-12 个')
    const rules = rawRules.map((rule,index) => ({id:String(rule.id || `dimension_${index + 1}`).trim(),name:String(rule.name || '').trim(),min:Number(rule.min),max:Number(rule.max),weight:Number(rule.weight),operation:rule.operation === 'subtract' ? 'subtract' : 'add',enabled:Boolean(rule.enabled)}))
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length || rules.some((rule) => !/^[A-Za-z0-9_-]{1,48}$/.test(rule.id))) throw appError('评分维度标识无效或重复')
    if (rules.some((rule) => !rule.name || rule.name.length > 30)) throw appError('评分维度名称不能为空且不能超过 30 个字符')
    if (rules.some((rule) => !Number.isInteger(rule.min) || !Number.isInteger(rule.max) || rule.min < 0 || rule.max > 99 || rule.min >= rule.max)) throw appError('评分范围必须是 0-99 内递增的整数')
    if (rules.some((rule) => !Number.isInteger(rule.weight) || rule.weight < 0 || rule.weight > 100)) throw appError('计入比例必须为 0-100 的整数')
    const enabledRules = rules.filter((rule) => rule.enabled)
    const equalAverage = enabledRules.length > 0 && enabledRules.every((rule) => rule.operation === 'add' && rule.weight === 100)
    const netWeight = enabledRules.reduce((sum,rule) => sum + (rule.operation === 'subtract' ? -1 : 1) * rule.weight,0)
    if (!enabledRules.length || (!equalAverage && netWeight !== 100)) throw appError('启用维度的净计入比例必须为 100%，或全部使用 100% 等权平均')

    const evaluationId = randomId('eval')
    const evaluationCode = this.uniqueEvaluationCode()
    const linkCode = this.uniqueLinkCode()
    const evaluation = {
      id:evaluationId,code:evaluationCode,linkCode,name,periodId:period.id,teamId:team.id,departmentId:team.department_id,status:'active',
      startTime,endTime,rules,rounding:input.rounding || 'one_decimal',participantMode,participantEmployeeIds,targetType,
      targetMode:targetType === 'team' ? targetMode : employeeTargetScope === 'custom' ? 'selected' : 'all',employeeTargetScope,targetTeamId,targetDepartmentId,
      targetEmployeeIds,targetTeamIds,excludeSelf:targetType === 'employee' && input.excludeSelf !== false,createdAt,updatedAt:createdAt
    }
    const targetIds = targetType === 'team' ? targetTeamIds : targetEmployeeIds
    const participants = participantMode === 'selected' ? participantEmployeeIds.map((id) => teamEmployees.find((item) => item.id === id)).filter(Boolean) : Array.from({length:participantCount},() => null)
    for (const participant of participants) {
      if (participant && targetType === 'employee' && evaluation.excludeSelf && targetIds.every((targetId) => targetId === participant.id)) throw appError(`${participant.name}没有可评价对象，请调整评价范围或关闭“排除自评”`)
    }
    const verifyRecords = []
    const taskRecords = []
    const returnedCodes = []
    const usedFingerprints = new Set(this.database.prepare('SELECT code_fingerprint FROM verification_codes').all().map((row) => row.code_fingerprint))
    for (const participant of participants) {
      const code = this.uniqueVerifyCode(usedFingerprints)
      const codeHash = sha256(`${evaluationId}:${code}`)
      const fingerprint = sha256(`employee-review:verify:${code}`)
      const evaluatorHash = sha256(`evaluator:${codeHash}`)
      usedFingerprints.add(fingerprint)
      const verifyId = randomId('verify')
      const participantId = participant?.id || ''
      const taskTargets = targetIds.filter((targetId) => !(targetType === 'employee' && evaluation.excludeSelf && participantId && targetId === participantId))
      const verify = {id:verifyId,evaluationCodeId:evaluationId,codeHash,codeFingerprint:fingerprint,codeMask:`****${code.slice(-2)}`,suffix:code.slice(-2),evaluatorHash,participantEmployeeId:participantId,expected:taskTargets.length,submitted:0,remaining:taskTargets.length,status:'unused',firstUsedAt:null,lastUsedAt:null,completedAt:null,createdAt}
      verifyRecords.push(verify)
      for (const targetId of taskTargets) taskRecords.push({id:randomId('task'),evaluationCodeId:evaluationId,verifyCodeId:verifyId,evaluatorHash,...(targetType === 'team' ? {targetType:'team',targetId,targetTeamId:targetId} : {targetType:'employee',targetId,targetEmployeeId:targetId}),status:'pending',submittedAt:null})
      returnedCodes.push({id:verifyId,code,employeeId:participantId,employeeName:participant?.name || ''})
    }

    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (periodMode !== 'existing') {
        const periodOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM review_periods').get().value)
        this.database.prepare('INSERT INTO review_periods (id,name,status,start_time,end_time,payload_json,list_order) VALUES (?,?,?,?,?,?,?)').run(period.id,period.name,period.status,period.startTime,period.endTime,json(period),periodOrder)
      }
      const evalPayload = {...evaluation}
      delete evalPayload.rules; delete evalPayload.participantEmployeeIds; delete evalPayload.targetEmployeeIds; delete evalPayload.targetTeamIds
      const evalOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM evaluation_activities').get().value)
      this.database.prepare('INSERT INTO evaluation_activities (id,code,link_code,name,period_id,department_id,team_id,status,start_time,end_time,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(evaluation.id,evaluation.code,evaluation.linkCode,evaluation.name,evaluation.periodId,evaluation.departmentId,evaluation.teamId,evaluation.status,evaluation.startTime,evaluation.endTime,json(evalPayload),evalOrder)
      const ruleInsert = this.database.prepare('INSERT INTO evaluation_rules (evaluation_id,rule_id,name,min_value,max_value,weight,operation,enabled,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?,?)')
      rules.forEach((rule,index) => ruleInsert.run(evaluation.id,rule.id,rule.name,rule.min,rule.max,rule.weight,rule.operation,rule.enabled ? 1 : 0,json(rule),index))
      const participantInsert = this.database.prepare('INSERT INTO evaluation_participants (evaluation_id,employee_id,list_order) VALUES (?,?,?)')
      participantEmployeeIds.forEach((employeeId,index) => participantInsert.run(evaluation.id,employeeId,index))
      const targetInsert = this.database.prepare('INSERT INTO evaluation_targets (evaluation_id,target_type,target_id,list_order) VALUES (?,?,?,?)')
      targetIds.forEach((targetId,index) => targetInsert.run(evaluation.id,targetType,targetId,index))
      const verifyInsert = this.database.prepare('INSERT INTO verification_codes (id,evaluation_id,participant_employee_id,code_hash,code_fingerprint,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)')
      verifyRecords.forEach((verify,index) => verifyInsert.run(verify.id,evaluation.id,verify.participantEmployeeId || null,verify.codeHash,verify.codeFingerprint,verify.status,json(verify),index))
      const taskOrderStart = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM evaluation_tasks').get().value)
      const taskInsert = this.database.prepare('INSERT INTO evaluation_tasks (id,evaluation_id,verification_code_id,target_type,target_id,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)')
      taskRecords.forEach((task,index) => taskInsert.run(task.id,evaluation.id,task.verifyCodeId,task.targetType,task.targetId,task.status,json(task),taskOrderStart + index))
      this.appendAudit('evaluation.create',{evaluationId:evaluation.id,name:evaluation.name},session,createdAt)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(createdAt)
      this.database.exec('COMMIT')
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
    const row = this.database.prepare('SELECT e.id,e.code,e.link_code,e.name,e.period_id,e.department_id,e.team_id,e.status,e.start_time,e.end_time,e.payload_json,e.list_order,t.name AS team_name,d.name AS department_name,p.name AS period_name FROM evaluation_activities e JOIN teams t ON t.id=e.team_id JOIN departments d ON d.id=e.department_id LEFT JOIN review_periods p ON p.id=e.period_id WHERE e.id=?').get(evaluation.id)
    const activity = this.scoreRepository.evaluationView(row)
    return {activity:{...activity,status:this.activityStatus(activity),lifecycleStatus:activity.status},period,verifyCodes:returnedCodes,participantCount:verifyRecords.length,taskCount:taskRecords.length,targetCount:targetIds.length}
  }

  uniqueEvaluationCode() {
    for (let index = 0; index < 10000; index += 1) {
      const code = `PJ${String(Math.floor(randomBytes(4).readUInt32BE(0) / 0x100000000 * 10000)).padStart(4,'0')}`
      if (!this.database.prepare('SELECT 1 FROM evaluation_activities WHERE code = ?').get(code)) return code
    }
    throw appError('无法生成唯一评价码',500,'CODE_GENERATION_FAILED')
  }

  uniqueLinkCode() {
    for (let index = 0; index < 10000; index += 1) {
      const code = String(Number(BigInt(`0x${randomBytes(6).toString('hex')}`) % 100000000n)).padStart(8,'0')
      if (!this.database.prepare('SELECT 1 FROM evaluation_activities WHERE link_code = ?').get(code) && !this.database.prepare('SELECT 1 FROM timed_invites WHERE link_code = ?').get(code)) return code
    }
    throw appError('无法生成唯一邀请链接',500,'CODE_GENERATION_FAILED')
  }

  uniqueVerifyCode(usedFingerprints) {
    for (let index = 0; index < 10000; index += 1) {
      const code = String(Math.floor(randomBytes(4).readUInt32BE(0) / 0x100000000 * 1000000)).padStart(6,'0')
      const fingerprint = sha256(`employee-review:verify:${code}`)
      if (!usedFingerprints.has(fingerprint)) return code
    }
    throw appError('无法生成唯一邀请码',500,'CODE_GENERATION_FAILED')
  }

  appendAudit(action, detail, actor, createdAt) {
    appendAuditRecord(this.database,action,detail,actor,createdAt)
  }
}
