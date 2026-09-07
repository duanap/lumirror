const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)

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

  findUser(userId) {
    const row = this.database.prepare('SELECT id, username, role, status, department_id, team_id, employee_id, payload_json FROM users WHERE id = ?').get(userId)
    if (!row) return null
    return {
      ...parseJson(row.payload_json), id:row.id, username:row.username, role:row.role, status:row.status,
      departmentId:row.department_id || '', teamId:row.team_id || '', employeeId:row.employee_id || ''
    }
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
