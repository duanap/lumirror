import { randomBytes, createHash } from 'node:crypto'

const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)
const json = (value) => JSON.stringify(value ?? null)
const hash = (value) => createHash('sha256').update(value).digest('hex')
const randomId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })

export class SqliteTaskRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteTaskRepository requires relational storage')
    this.database = storage.database
  }

  getPublicSessionSeconds(fallbackSeconds = 7200) {
    const row = this.database.prepare('SELECT public_session_minutes FROM settings WHERE singleton = 1').get()
    const minutes = Number(row?.public_session_minutes)
    if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 240) return minutes * 60
    return Number.isFinite(Number(fallbackSeconds)) && Number(fallbackSeconds) > 0 ? Number(fallbackSeconds) : 7200
  }

  findEvaluationTitle(linkCode) {
    const row = this.database.prepare('SELECT name,status,start_time,end_time FROM evaluation_activities WHERE upper(link_code)=upper(?)').get(linkCode)
    if (!row) return null
    const now = Date.now(), start = new Date(row.start_time).getTime(), end = new Date(row.end_time).getTime()
    if (row.status === 'disabled' || row.status === 'archived' || (Number.isFinite(start) && now < start) || (Number.isFinite(end) && now > end)) return null
    return {name:row.name}
  }

  openVerifyEntry({linkCode, verifyCode}) {
    // The evaluation ID is part of the code hash, so resolve the activity first without exposing the code.
    const candidates = this.database.prepare(`
      SELECT e.id AS evaluation_id,e.name AS evaluation_name,e.status AS evaluation_status,e.start_time,e.end_time,t.name AS team_name,
        v.id AS verify_id,v.code_hash,v.status AS verify_status,v.payload_json AS verify_payload
      FROM evaluation_activities e JOIN teams t ON t.id=e.team_id JOIN verification_codes v ON v.evaluation_id=e.id
      WHERE upper(e.link_code)=upper(?)
    `).all(linkCode)
    const candidate = candidates.find((item) => item.code_hash === hash(`${item.evaluation_id}:${String(verifyCode || '').trim().toUpperCase()}`))
    if (!candidate) return null
    const nowMs = Date.now(), start = new Date(candidate.start_time).getTime(), end = new Date(candidate.end_time).getTime()
    if (candidate.evaluation_status === 'disabled' || candidate.evaluation_status === 'archived' || (Number.isFinite(start) && nowMs < start) || (Number.isFinite(end) && nowMs > end)) return {kind:'ended'}
    const progress = this.findProgress({evaluationId:candidate.evaluation_id,verifyId:candidate.verify_id})
    if (!progress || progress.expected === 0) return {kind:'no-tasks'}
    if (progress.remaining === 0 || candidate.verify_status === 'completed') return {kind:'completed'}
    const payload = parseJson(candidate.verify_payload)
    const firstUsedAt = payload.firstUsedAt || new Date().toISOString()
    const updated = {...payload,firstUsedAt,lastUsedAt:new Date().toISOString(),status:'in_progress'}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE verification_codes SET status=?,payload_json=? WHERE id=?').run('in_progress',json(updated),candidate.verify_id)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updated.lastUsedAt)
      this.database.exec('COMMIT')
      return {kind:'ready',evaluationId:candidate.evaluation_id,evaluationName:candidate.evaluation_name,teamName:candidate.team_name,verifyId:candidate.verify_id,evaluatorHash:payload.evaluatorHash,remaining:progress.remaining}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id, username, role, status, department_id, team_id, employee_id, payload_json FROM users WHERE id = ?').get(userId)
    if (!row) return null
    return {
      ...parseJson(row.payload_json), id:row.id, username:row.username, role:row.role, status:row.status,
      departmentId:row.department_id || '', teamId:row.team_id || '', employeeId:row.employee_id || ''
    }
  }

  evaluationContext(evaluationId, session) {
    const row = this.database.prepare('SELECT id, name, status, team_id, department_id, start_time, end_time, payload_json FROM evaluation_activities WHERE id = ?').get(evaluationId)
    if (!row || session.role === 'member' || (session.role === 'team_leader' && session.teamId !== row.team_id) || (session.role === 'leader' && session.departmentId !== row.department_id)) throw appError('评价活动不存在或无权操作',404,'NOT_FOUND')
    if (session.role !== 'admin' && session.role !== 'team_leader') throw appError('当前账号没有此操作权限',403,'FORBIDDEN')
    const payload = parseJson(row.payload_json)
    const targetRows = this.database.prepare('SELECT target_type,target_id FROM evaluation_targets WHERE evaluation_id = ? ORDER BY list_order').all(evaluationId)
    return {row,payload,targetType:targetRows[0]?.target_type || payload.targetType || 'employee',targetIds:targetRows.map((target) => target.target_id)}
  }

  activeTargets(context) {
    return context.targetType === 'team'
      ? this.database.prepare(`SELECT t.id,t.name FROM teams t JOIN evaluation_targets et ON et.target_id=t.id AND et.target_type='team' WHERE et.evaluation_id=? AND t.status='active' ORDER BY et.list_order`).all(context.row.id)
      : this.database.prepare(`SELECT e.id,e.name,e.team_id FROM employees e JOIN evaluation_targets et ON et.target_id=e.id AND et.target_type='employee' WHERE et.evaluation_id=? AND e.status='active' ORDER BY et.list_order`).all(context.row.id)
  }

  createVerifyRecords(evaluationId, session, { participantEmployeeIds = [], count = 0, timed = false } = {}) {
    const context = this.evaluationContext(evaluationId,session)
    if (context.row.status === 'archived') throw appError('已归档活动为只读状态，不能生成邀请码',409,'EVALUATION_ARCHIVED')
    const targets = this.activeTargets(context)
    if (!targets.length) throw appError('评价对象不能为空')
    const employees = participantEmployeeIds.length
      ? this.database.prepare(`SELECT id,name,team_id FROM employees WHERE id IN (${participantEmployeeIds.map(() => '?').join(',')}) AND status='active'`).all(...participantEmployeeIds)
      : []
    if (participantEmployeeIds.length && employees.length !== new Set(participantEmployeeIds).size) throw appError('所选成员不存在或无效')
    const participants = participantEmployeeIds.length ? employees : Array.from({length:count},() => null)
    if (!participants.length) throw appError('至少需要生成 1 个邀请码')
    const evaluation = {...context.payload,id:context.row.id,targetType:context.targetType,excludeSelf:Boolean(context.payload.excludeSelf)}
    const existingParticipants = new Set(this.database.prepare('SELECT participant_employee_id FROM verification_codes WHERE evaluation_id = ? AND participant_employee_id IS NOT NULL').all(evaluationId).map((row) => row.participant_employee_id))
    if (participantEmployeeIds.some((id) => existingParticipants.has(id))) throw appError('所选成员在该活动中已绑定邀请码')
    const created = []
    const usedFingerprints = new Set(this.database.prepare('SELECT code_fingerprint FROM verification_codes').all().map((row) => row.code_fingerprint))
    for (const participant of participants) {
      const taskTargets = targets.filter((target) => !(evaluation.targetType === 'employee' && evaluation.excludeSelf && participant?.id && target.id === participant.id))
      if (participant && !taskTargets.length) throw appError(`${participant.name}没有可评价对象，请调整评价范围或关闭“排除自评”`)
      let code
      let fingerprint
      do {
        code = String(Math.floor(randomBytes(4).readUInt32BE(0) / 0x100000000 * 1000000)).padStart(6,'0')
        fingerprint = hash(`employee-review:verify:${code}`)
      } while (usedFingerprints.has(fingerprint))
      usedFingerprints.add(fingerprint)
      const codeHash = hash(`${evaluationId}:${code}`)
      const evaluatorHash = hash(`evaluator:${codeHash}`)
      const verifyId = randomId('verify')
      const createdAt = new Date().toISOString()
      const verify = {id:verifyId,evaluationCodeId:evaluationId,codeHash,codeFingerprint:fingerprint,codeMask:`****${code.slice(-2)}`,suffix:code.slice(-2),evaluatorHash,participantEmployeeId:participant?.id || '',expected:taskTargets.length,submitted:0,remaining:taskTargets.length,status:'unused',firstUsedAt:null,lastUsedAt:null,completedAt:null,createdAt}
      const tasks = taskTargets.map((target) => ({id:randomId('task'),evaluationCodeId:evaluationId,verifyCodeId:verifyId,evaluatorHash,...(evaluation.targetType === 'team' ? {targetType:'team',targetId:target.id,targetTeamId:target.id} : {targetType:'employee',targetId:target.id,targetEmployeeId:target.id}),status:'pending',submittedAt:null}))
      created.push({verify,tasks,code,employeeId:participant?.id || '',employeeName:participant?.name || ''})
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const verifyOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM verification_codes').get().value)
      const taskOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM evaluation_tasks').get().value)
      const verifyInsert = this.database.prepare('INSERT INTO verification_codes (id,evaluation_id,participant_employee_id,code_hash,code_fingerprint,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)')
      const taskInsert = this.database.prepare('INSERT INTO evaluation_tasks (id,evaluation_id,verification_code_id,target_type,target_id,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)')
      const inviteInsert = timed ? this.database.prepare('INSERT INTO timed_invites (id,evaluation_id,verification_code_id,link_code,status,expires_at,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)') : null
      let verifyIndex = 0
      let taskIndex = 0
      for (const item of created) {
        verifyInsert.run(item.verify.id,evaluationId,item.verify.participantEmployeeId || null,item.verify.codeHash,item.verify.codeFingerprint,item.verify.status,json(item.verify),verifyOrder + verifyIndex++)
        for (const task of item.tasks) taskInsert.run(task.id,evaluationId,item.verify.id,task.targetType,task.targetId,task.status,json(task),taskOrder + taskIndex++)
        if (timed) {
          const linkCode = this.uniqueLinkCode()
          const invite = {id:randomId('timed'),linkCode,evaluationCodeId:evaluationId,verifyCodeId:item.verify.id,status:'unused',createdAt:new Date().toISOString(),firstOpenedAt:null,expiresAt:null,completedAt:null}
          inviteInsert.run(invite.id,evaluationId,item.verify.id,linkCode,'unused',null,json(invite),verifyIndex - 1)
          item.invite = invite
        }
      }
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(new Date().toISOString())
      this.database.exec('COMMIT')
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
    return {created,targets:targets.length}
  }

  generateVerifyCodes(evaluationId, session, input) {
    const participantEmployeeIds = Array.isArray(input.participantEmployeeIds) ? [...new Set(input.participantEmployeeIds.map(String).filter(Boolean))] : []
    const count = participantEmployeeIds.length ? 0 : Math.min(100,Math.max(1,Number(input.count) || 1))
    const generated = this.createVerifyRecords(evaluationId,session,{participantEmployeeIds,count})
    return {codes:generated.created.map((item) => ({id:item.verify.id,code:item.code,employeeId:item.employeeId,employeeName:item.employeeName})),taskCount:generated.created.reduce((sum,item) => sum + item.tasks.length,0),targetCount:generated.targets}
  }

  generateTimedInvite(evaluationId, session) {
    const generated = this.createVerifyRecords(evaluationId,session,{count:1,timed:true})
    const item = generated.created[0]
    return {id:item.invite.id,linkCode:item.invite.linkCode,evaluationCodeId:evaluationId,activityName:this.database.prepare('SELECT name FROM evaluation_activities WHERE id=?').get(evaluationId).name,taskCount:item.tasks.length,targetCount:generated.targets}
  }

  generateTasks(evaluationId, session) {
    const context = this.evaluationContext(evaluationId,session)
    if (context.row.status === 'archived') throw appError('已归档活动为只读状态，不能同步任务',409,'EVALUATION_ARCHIVED')
    const targets = this.activeTargets(context)
    const targetKeys = new Set(targets.map((target) => `${context.targetType}:${target.id}`))
    const verifies = this.database.prepare('SELECT id,participant_employee_id,payload_json FROM verification_codes WHERE evaluation_id = ? ORDER BY list_order').all(evaluationId)
    let created = 0
    let removed = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      let nextOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM evaluation_tasks').get().value)
      for (const verify of verifies) {
        const verifyPayload = parseJson(verify.payload_json)
        const desired = targets.filter((target) => !(context.targetType === 'employee' && context.payload.excludeSelf && verify.participant_employee_id && target.id === verify.participant_employee_id))
        const existing = this.database.prepare('SELECT id,target_type,target_id,status FROM evaluation_tasks WHERE verification_code_id = ?').all(verify.id)
        const desiredKeys = new Set(desired.map((target) => `${context.targetType}:${target.id}`))
        for (const task of existing) {
          if (!desiredKeys.has(`${task.target_type}:${task.target_id}`) && task.status !== 'submitted') {
            this.database.prepare('DELETE FROM evaluation_tasks WHERE id = ?').run(task.id)
            removed++
          }
        }
        const current = new Set(this.database.prepare('SELECT target_type,target_id FROM evaluation_tasks WHERE verification_code_id = ?').all(verify.id).map((task) => `${task.target_type}:${task.target_id}`))
        const insert = this.database.prepare('INSERT INTO evaluation_tasks (id,evaluation_id,verification_code_id,target_type,target_id,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)')
        for (const target of desired) {
          const key = `${context.targetType}:${target.id}`
          if (current.has(key)) continue
          const task = {id:randomId('task'),evaluationCodeId:evaluationId,verifyCodeId:verify.id,evaluatorHash:verifyPayload.evaluatorHash,...(context.targetType === 'team' ? {targetType:'team',targetId:target.id,targetTeamId:target.id} : {targetType:'employee',targetId:target.id,targetEmployeeId:target.id}),status:'pending',submittedAt:null}
          insert.run(task.id,evaluationId,verify.id,task.targetType,task.targetId,'pending',json(task),nextOrder++)
          created++
        }
        const progress = this.database.prepare("SELECT COUNT(*) AS expected,SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id=?").get(verify.id)
        const expected = Number(progress.expected || 0)
        const submitted = Number(progress.submitted || 0)
        const nextVerify = {...verifyPayload,expected,submitted,remaining:Math.max(0,expected-submitted),status:expected > 0 && submitted === expected ? 'completed' : verifyPayload.firstUsedAt ? 'in_progress' : 'unused'}
        if (nextVerify.status === 'completed') nextVerify.completedAt ||= new Date().toISOString()
        else nextVerify.completedAt = null
        this.database.prepare('UPDATE verification_codes SET status=?,payload_json=? WHERE id=?').run(nextVerify.status,json(nextVerify),verify.id)
      }
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return {created,removed}
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  deleteVerifyCode(verifyId, session) {
    const row = this.database.prepare('SELECT v.id,v.evaluation_id,v.payload_json,e.status,e.team_id,e.department_id FROM verification_codes v JOIN evaluation_activities e ON e.id=v.evaluation_id WHERE v.id=?').get(verifyId)
    if (!row) throw appError('邀请码不存在或无权删除',404,'NOT_FOUND')
    if ((session.role !== 'admin' && !(session.role === 'team_leader' && session.teamId === row.team_id)) || row.status === 'archived') throw appError('邀请码不存在或无权删除',404,'NOT_FOUND')
    if (row.status === 'archived') throw appError('已归档活动为只读状态',409,'EVALUATION_ARCHIVED')
    if (this.database.prepare("SELECT 1 FROM evaluation_tasks WHERE verification_code_id=? AND status='submitted' LIMIT 1").get(verifyId)) throw appError('该邀请码已有提交记录，不能删除',409)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM verification_codes WHERE id=?').run(verifyId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return {deleted:true}
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  deleteTask(taskId, session) {
    const row = this.database.prepare('SELECT t.id,t.status,t.verification_code_id,e.id AS evaluation_id,e.status AS evaluation_status,e.team_id,e.department_id FROM evaluation_tasks t JOIN evaluation_activities e ON e.id=t.evaluation_id WHERE t.id=?').get(taskId)
    if (!row || (session.role !== 'admin' && !(session.role === 'team_leader' && session.teamId === row.team_id))) throw appError('任务不存在或无权删除',404,'NOT_FOUND')
    if (row.evaluation_status === 'archived') throw appError('已归档活动为只读状态',409,'EVALUATION_ARCHIVED')
    if (row.status === 'submitted' || this.database.prepare('SELECT 1 FROM scores WHERE task_id=?').get(taskId)) throw appError('已提交任务不能删除',409)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM evaluation_tasks WHERE id=?').run(taskId)
      const verify = this.database.prepare('SELECT payload_json FROM verification_codes WHERE id=?').get(row.verification_code_id)
      if (verify) {
        const payload = parseJson(verify.payload_json)
        const progress = this.database.prepare("SELECT COUNT(*) AS expected,SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id=?").get(row.verification_code_id)
        const expected = Number(progress.expected || 0), submitted = Number(progress.submitted || 0)
        payload.expected=expected;payload.submitted=submitted;payload.remaining=Math.max(0,expected-submitted)
        this.database.prepare('UPDATE verification_codes SET status=?,payload_json=? WHERE id=?').run(expected > 0 && submitted === expected ? 'completed' : payload.firstUsedAt ? 'in_progress' : 'unused',json(payload),row.verification_code_id)
      }
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return {deleted:true}
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  uniqueLinkCode() {
    for (let index = 0; index < 10000; index += 1) {
      const code = String(Number(BigInt(`0x${randomBytes(6).toString('hex')}`) % 100000000n)).padStart(8,'0')
      if (!this.database.prepare('SELECT 1 FROM evaluation_activities WHERE link_code=?').get(code) && !this.database.prepare('SELECT 1 FROM timed_invites WHERE link_code=?').get(code)) return code
    }
    throw appError('无法生成唯一邀请链接',500,'CODE_GENERATION_FAILED')
  }

  visibleEvaluations(session) {
    const scope = session.role === 'admin' ? '' : session.role === 'team_leader' ? ' AND e.team_id = ?' : ' AND e.department_id = ?'
    const scopeValue = session.role === 'team_leader' ? session.teamId : session.departmentId
    return this.database.prepare(`
      SELECT e.id, e.name, e.status, e.start_time, e.end_time, e.team_id, t.name AS team_name
      FROM evaluation_activities e JOIN teams t ON t.id = e.team_id
      WHERE 1 = 1${scope} ORDER BY e.list_order
    `).all(...(scope ? [scopeValue] : []))
  }

  listAdminTasks(session, evaluationId = '') {
    const evaluations = this.visibleEvaluations(session)
    const allowedIds = new Set(evaluations.map((row) => row.id))
    const selectedIds = evaluationId && allowedIds.has(evaluationId) ? [evaluationId] : [...allowedIds]
    if (!selectedIds.length) return { items:[], activities:[], canWrite:session.role === 'admin' || session.role === 'team_leader' }
    const placeholders = selectedIds.map(() => '?').join(',')
    const rows = this.database.prepare(`
      SELECT t.id, t.evaluation_id, t.verification_code_id, t.target_type, t.target_id, t.status, t.payload_json,
        v.payload_json AS verify_payload, e.name AS activity_name, e.team_id, tm.name AS team_name,
        emp.name AS employee_name, json_extract(emp.payload_json, '$.position') AS employee_position, teamp.name AS target_team_name,
        participant.name AS participant_name
      FROM evaluation_tasks t
      JOIN verification_codes v ON v.id = t.verification_code_id
      JOIN evaluation_activities e ON e.id = t.evaluation_id
      LEFT JOIN teams tm ON tm.id = e.team_id
      LEFT JOIN employees emp ON t.target_type = 'employee' AND emp.id = t.target_id
      LEFT JOIN teams teamp ON t.target_type = 'team' AND teamp.id = t.target_id
      LEFT JOIN employees participant ON participant.id = json_extract(v.payload_json, '$.participantEmployeeId')
      WHERE t.evaluation_id IN (${placeholders}) ORDER BY t.list_order
    `).all(...selectedIds)
    const items = rows.map((row) => {
      const task = parseJson(row.payload_json)
      const verify = parseJson(row.verify_payload)
      const isTeam = row.target_type === 'team'
      return {
        ...task,id:row.id,evaluationCodeId:row.evaluation_id,verifyCodeId:row.verification_code_id,
        targetType:row.target_type,targetId:row.target_id,status:row.status,evaluatorHash:undefined,
        activityName:row.activity_name,verifyCode:verify.code || verify.codeMask || `****${verify.suffix || ''}`,
        participantName:row.participant_name || '未绑定成员',targetName:isTeam ? row.target_team_name : row.employee_name,
        teamName:isTeam ? row.target_team_name : row.team_name,scopeName:isTeam ? row.team_name : row.team_name,
        position:isTeam ? undefined : row.employee_position
      }
    })
    return {items,activities:evaluations.map((row) => ({id:row.id,name:row.name,teamName:row.team_name})),canWrite:session.role === 'admin' || session.role === 'team_leader'}
  }

  listVerifyCodes(session, evaluationId = '') {
    const evaluations = this.visibleEvaluations(session)
    const allowedIds = new Set(evaluations.map((row) => row.id))
    const selectedIds = evaluationId && allowedIds.has(evaluationId) ? [evaluationId] : [...allowedIds]
    if (!selectedIds.length) return {items:[],activities:[],canWrite:session.role === 'admin' || session.role === 'team_leader'}
    const placeholders = selectedIds.map(() => '?').join(',')
    const rows = this.database.prepare(`
      SELECT v.id, v.evaluation_id, v.status, v.payload_json, e.name AS activity_name, e.team_id, t.name AS team_name,
        participant.name AS participant_name
      FROM verification_codes v JOIN evaluation_activities e ON e.id = v.evaluation_id
      LEFT JOIN teams t ON t.id = e.team_id
      LEFT JOIN employees participant ON participant.id = json_extract(v.payload_json, '$.participantEmployeeId')
      WHERE v.evaluation_id IN (${placeholders}) ORDER BY v.list_order
    `).all(...selectedIds)
    const items = rows.map((row) => {
      const verify = parseJson(row.payload_json)
      const progress = this.findProgress({evaluationId:row.evaluation_id,verifyId:row.id})
      const status = progress.remaining === 0 && progress.expected > 0 ? 'completed' : progress.status
      return {
        id:row.id,evaluationCodeId:row.evaluation_id,code:verify.code || verify.codeMask || `****${verify.suffix || ''}`,
        activityName:row.activity_name,teamName:row.team_name || '',participantName:row.participant_name || '未绑定成员',
        expected:progress.expected,submitted:progress.submitted,remaining:progress.remaining,status,
        statusLabel:status === 'completed' ? '已完成' : status === 'in_progress' ? '进行中' : status === 'unused' ? '未使用' : status,
        firstUsedAt:verify.firstUsedAt || null,completedAt:status === 'completed' ? verify.completedAt || null : null
      }
    })
    return {
      items,activities:evaluations.map((row) => ({id:row.id,name:row.name,status:row.status,teamId:row.team_id,teamName:row.team_name || ''})),
      canWrite:session.role === 'admin' || session.role === 'team_leader'
    }
  }

  listTimedInvites(session, evaluationId = '') {
    const evaluations = this.visibleEvaluations(session)
    const allowedIds = new Set(evaluations.map((row) => row.id))
    const selectedIds = evaluationId && allowedIds.has(evaluationId) ? [evaluationId] : [...allowedIds]
    if (!selectedIds.length) return {items:[],activities:[]}
    const placeholders = selectedIds.map(() => '?').join(',')
    const rows = this.database.prepare(`
      SELECT i.id, i.evaluation_id, i.verification_code_id, i.link_code, i.status, i.expires_at, i.payload_json,
        e.name AS activity_name, t.name AS team_name
      FROM timed_invites i JOIN evaluation_activities e ON e.id = i.evaluation_id
      LEFT JOIN teams t ON t.id = e.team_id
      WHERE i.evaluation_id IN (${placeholders}) ORDER BY i.list_order DESC
    `).all(...selectedIds)
    const items = rows.map((row) => {
      const invite = {...parseJson(row.payload_json),id:row.id,evaluationCodeId:row.evaluation_id,verifyCodeId:row.verification_code_id,linkCode:row.link_code,status:row.status,expiresAt:row.expires_at}
      const progress = this.findProgress({evaluationId:row.evaluation_id,verifyId:row.verification_code_id})
      const totalTasks = progress.expected
      const completedTasks = progress.submitted
      const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now())
      const status = totalTasks > 0 && completedTasks === totalTasks ? 'completed' : expired ? 'expired' : invite.firstOpenedAt ? 'in_progress' : 'unused'
      return {
        ...invite,status,statusLabel:status === 'completed' ? '已完成' : status === 'expired' ? '已过期' : status === 'in_progress' ? '评价中' : '未开始',
        totalTasks,completedTasks,remainingTasks:Math.max(0,totalTasks - completedTasks),allCompleted:totalTasks > 0 && completedTasks === totalTasks,
        activityName:row.activity_name || '',teamName:row.team_name || ''
      }
    })
    return {items,activities:evaluations.map((row) => ({id:row.id,name:row.name,status:row.status,teamName:row.team_name || ''}))}
  }

  findProgress({ evaluationId, verifyId, timedInviteId = '' }) {
    const verifyRow = this.database.prepare('SELECT id, status, payload_json FROM verification_codes WHERE id = ? AND evaluation_id = ?').get(verifyId, evaluationId)
    if (!verifyRow) return null
    const progress = this.database.prepare(`
      SELECT COUNT(*) AS expected,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted
      FROM evaluation_tasks WHERE verification_code_id = ?
    `).get(verifyId)
    const expected = Number(progress.expected || 0)
    const submitted = Number(progress.submitted || 0)
    const result = { expected, submitted, remaining:Math.max(0, expected - submitted), status:verifyRow.status, timedInvite:null }
    if (timedInviteId) {
      const inviteRow = this.database.prepare('SELECT id, status, expires_at, payload_json FROM timed_invites WHERE id = ? AND evaluation_id = ? AND verification_code_id = ?').get(timedInviteId, evaluationId, verifyId)
      if (inviteRow) result.timedInvite = {
        ...parseJson(inviteRow.payload_json), id:inviteRow.id, status:inviteRow.status, expiresAt:inviteRow.expires_at
      }
    }
    return result
  }

  openTimedInvite({ linkCode, lifetimeSeconds, now = new Date() }) {
    const nowText = now.toISOString()
    const nowMs = now.getTime()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const row = this.database.prepare(`
        SELECT i.id, i.evaluation_id, i.verification_code_id, i.status AS invite_status, i.expires_at,
          i.payload_json AS invite_payload, e.status AS evaluation_status, e.start_time, e.end_time,
          e.team_id, e.payload_json AS evaluation_payload, v.status AS verify_status, v.payload_json AS verify_payload,
          t.name AS team_name
        FROM timed_invites i
        JOIN evaluation_activities e ON e.id = i.evaluation_id
        JOIN verification_codes v ON v.id = i.verification_code_id
        LEFT JOIN teams t ON t.id = e.team_id
        WHERE i.link_code = ?
      `).get(linkCode)
      if (!row) {
        this.database.exec('COMMIT')
        return { kind:'not-found' }
      }
      if (['completed','expired'].includes(row.invite_status)) {
        this.database.exec('COMMIT')
        return { kind:'not-found' }
      }
      const evaluation = {
        ...parseJson(row.evaluation_payload), id:row.evaluation_id, teamId:row.team_id,
        status:row.evaluation_status, startTime:row.start_time, endTime:row.end_time, teamName:row.team_name || ''
      }
      const start = new Date(String(evaluation.startTime || '')).getTime()
      const end = new Date(String(evaluation.endTime || '')).getTime()
      if (evaluation.status === 'disabled' || evaluation.status === 'archived' || (Number.isFinite(start) && nowMs < start) || (Number.isFinite(end) && nowMs > end)) {
        this.database.exec('COMMIT')
        return { kind:'ended' }
      }
      const progress = this.findProgress({evaluationId:row.evaluation_id,verifyId:row.verification_code_id})
      if (!progress || progress.expected === 0 || progress.remaining === 0) {
        const invitePayload = {...parseJson(row.invite_payload), status:'completed', completedAt:parseJson(row.invite_payload).completedAt || nowText}
        this.database.prepare('UPDATE timed_invites SET status = ?, payload_json = ? WHERE id = ?').run('completed',json(invitePayload),row.id)
        this.database.exec('COMMIT')
        return { kind:'completed' }
      }
      const invitePayload = {...parseJson(row.invite_payload)}
      if (!invitePayload.firstOpenedAt) {
        invitePayload.firstOpenedAt = nowText
        invitePayload.expiresAt = new Date(nowMs + Number(lifetimeSeconds) * 1000).toISOString()
        invitePayload.status = 'active'
      }
      const expiresAt = invitePayload.expiresAt || row.expires_at
      if (!expiresAt || new Date(expiresAt).getTime() <= nowMs) {
        invitePayload.status = 'expired'
        this.database.prepare('UPDATE timed_invites SET status = ?, expires_at = ?, payload_json = ? WHERE id = ?').run('expired',expiresAt || null,json(invitePayload),row.id)
        this.database.exec('COMMIT')
        return { kind:'expired' }
      }
      const verifyPayload = {...parseJson(row.verify_payload), firstUsedAt:parseJson(row.verify_payload).firstUsedAt || nowText, lastUsedAt:nowText, status:'in_progress'}
      this.database.prepare('UPDATE verification_codes SET status = ?, payload_json = ? WHERE id = ?').run('in_progress',json(verifyPayload),row.verification_code_id)
      this.database.prepare('UPDATE timed_invites SET status = ?, expires_at = ?, payload_json = ? WHERE id = ?').run('active',expiresAt,json({...invitePayload,expiresAt,status:'active'}),row.id)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(nowText)
      this.database.exec('COMMIT')
      return {
        kind:'ready', evaluation, verifyId:row.verification_code_id, evaluatorHash:parseJson(row.verify_payload).evaluatorHash,
        inviteId:row.id, expiresAt, remaining:progress.remaining,
        expiresIn:Math.max(1,Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000))
      }
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }

  findCurrentTask({ evaluationId, verifyId, timedInviteId = '' }) {
    const evaluationRow = this.database.prepare(`
      SELECT id, team_id, status, start_time, end_time, payload_json
      FROM evaluation_activities WHERE id = ?
    `).get(evaluationId)
    const verifyRow = this.database.prepare(`
      SELECT id, status, payload_json FROM verification_codes
      WHERE id = ? AND evaluation_id = ?
    `).get(verifyId, evaluationId)
    if (!evaluationRow || !verifyRow) return null

    const progress = this.findProgress({evaluationId,verifyId,timedInviteId})
    if (!progress) return null
    const { expected, submitted, remaining } = progress

    const timedInvite = progress.timedInvite

    const taskRow = this.database.prepare(`
      SELECT id, evaluation_id, verification_code_id, target_type, target_id, status, payload_json
      FROM evaluation_tasks
      WHERE evaluation_id = ? AND verification_code_id = ? AND status = 'pending'
      ORDER BY list_order LIMIT 1
    `).get(evaluationId, verifyId)
    const evaluation = {
      ...parseJson(evaluationRow.payload_json), id:evaluationRow.id, teamId:evaluationRow.team_id,
      status:evaluationRow.status, startTime:evaluationRow.start_time, endTime:evaluationRow.end_time
    }
    const rules = this.database.prepare(`
      SELECT payload_json FROM evaluation_rules WHERE evaluation_id = ? ORDER BY list_order
    `).all(evaluationId).map((row) => parseJson(row.payload_json))
    const team = this.database.prepare('SELECT id, name, department_id, payload_json FROM teams WHERE id = ?').get(evaluationRow.team_id)
    evaluation.name ||= parseJson(evaluationRow.payload_json).name || ''
    const evaluationView = {
      id:evaluation.id, name:evaluation.name, teamName:team?.name || '',
      status:evaluation.status, startTime:evaluation.startTime, endTime:evaluation.endTime, rounding:evaluation.rounding
    }
    if (!taskRow) return { evaluation:evaluationView, rules, timedInvite, remaining, expected, submitted, task:null }

    const task = {
      ...parseJson(taskRow.payload_json), id:taskRow.id, evaluationCodeId:taskRow.evaluation_id,
      verifyCodeId:taskRow.verification_code_id, targetType:taskRow.target_type, targetId:taskRow.target_id,
      status:taskRow.status
    }
    if (taskRow.target_type === 'team') {
      const targetRow = this.database.prepare(`
        SELECT t.id, t.name, t.department_id, t.payload_json, d.name AS department_name
        FROM teams t JOIN departments d ON d.id = t.department_id WHERE t.id = ? AND t.status = 'active'
      `).get(taskRow.target_id)
      if (!targetRow) return { evaluation:evaluationView, rules, timedInvite, remaining, expected, submitted, task:null }
      const memberCount = this.database.prepare("SELECT COUNT(*) AS value FROM employees WHERE team_id = ? AND status = 'active'").get(targetRow.id).value
      task.target = {
        ...parseJson(targetRow.payload_json), id:targetRow.id, targetType:'team', targetId:targetRow.id,
        targetTeamId:targetRow.id, teamName:targetRow.name, departmentName:targetRow.department_name,
        memberCount:Number(memberCount || 0)
      }
    } else {
      const targetRow = this.database.prepare(`
        SELECT e.id, e.department_id, e.team_id, e.status, e.payload_json,
          d.name AS department_name, t.name AS team_name
        FROM employees e JOIN departments d ON d.id = e.department_id JOIN teams t ON t.id = e.team_id
        WHERE e.id = ? AND e.status = 'active'
      `).get(taskRow.target_id)
      if (!targetRow) return { evaluation:evaluationView, rules, timedInvite, remaining, expected, submitted, task:null }
      const tagIds = this.database.prepare('SELECT tag_id FROM employee_tags WHERE employee_id = ? ORDER BY list_order').all(targetRow.id).map((row) => row.tag_id)
      const tags = tagIds.length
        ? this.database.prepare(`SELECT payload_json FROM member_tags WHERE id IN (${tagIds.map(() => '?').join(',')})`).all(...tagIds).map((row) => parseJson(row.payload_json))
        : []
      task.target = {
        ...parseJson(targetRow.payload_json), id:targetRow.id, departmentId:targetRow.department_id, teamId:targetRow.team_id,
        status:targetRow.status, targetType:'employee', targetId:targetRow.id, targetEmployeeId:targetRow.id,
        departmentName:targetRow.department_name, teamName:targetRow.team_name, tagIds, tags
      }
    }
    return { evaluation:evaluationView, rules, timedInvite, remaining, expected, submitted, task }
  }
}
