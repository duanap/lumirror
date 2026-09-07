function repositoryError(message, code = 'TASK_ALREADY_SUBMITTED') {
  const error = new Error(message)
  error.status = 409
  error.code = code
  return error
}

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)
const round = (value) => Math.round(Number(value) * 10) / 10

export class SqliteScoreRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteScoreRepository requires relational storage')
    this.database = storage.database
  }

  create(input) {
    return this.submitAtomic(input)
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id, username, role, status, department_id, team_id, employee_id, payload_json FROM users WHERE id = ?').get(userId)
    if (!row) return null
    return {
      ...parseJson(row.payload_json), id:row.id, username:row.username, role:row.role, status:row.status,
      departmentId:row.department_id || '', teamId:row.team_id || '', employeeId:row.employee_id || ''
    }
  }

  visibleEvaluationRows(session) {
    const scope = session.role === 'admin' ? '' : session.role === 'team_leader' ? ' AND e.team_id = ?' : ' AND e.department_id = ?'
    const scopeValue = session.role === 'team_leader' ? session.teamId : session.departmentId
    return this.database.prepare(`
      SELECT e.id, e.code, e.link_code, e.name, e.period_id, e.department_id, e.team_id,
        e.status, e.start_time, e.end_time, e.payload_json, e.list_order,
        t.name AS team_name, d.name AS department_name, p.name AS period_name
      FROM evaluation_activities e
      JOIN teams t ON t.id = e.team_id
      JOIN departments d ON d.id = e.department_id
      LEFT JOIN review_periods p ON p.id = e.period_id
      WHERE 1 = 1${scope} ORDER BY e.list_order
    `).all(...(scope ? [scopeValue] : []))
  }

  evaluationView(row) {
    const payload = parseJson(row.payload_json)
    const targetRows = this.database.prepare('SELECT target_type, target_id FROM evaluation_targets WHERE evaluation_id = ? ORDER BY list_order').all(row.id)
    const targetType = targetRows[0]?.target_type || payload.targetType || 'employee'
    payload.targetEmployeeIds = targetRows.filter((target) => target.target_type === 'employee').map((target) => target.target_id)
    payload.targetTeamIds = targetRows.filter((target) => target.target_type === 'team').map((target) => target.target_id)
    const verifyStats = this.database.prepare(`
      SELECT COUNT(*) AS participant_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_participants
      FROM verification_codes WHERE evaluation_id = ?
    `).get(row.id)
    const taskCount = this.database.prepare('SELECT COUNT(*) AS value FROM evaluation_tasks WHERE evaluation_id = ?').get(row.id).value
    const participantCount = Number(verifyStats.participant_count || 0)
    const completedParticipants = Number(verifyStats.completed_participants || 0)
    return {
      ...payload, id:row.id, code:row.code, linkCode:row.link_code, name:row.name,
      periodId:row.period_id, departmentId:row.department_id, teamId:row.team_id,
      status:row.status, startTime:row.start_time, endTime:row.end_time,
      periodName:row.period_name || '', teamName:row.team_name || '', departmentName:row.department_name || '',
      participantCount, completedParticipants, pendingParticipants:Math.max(0,participantCount - completedParticipants),
      completionRate:participantCount ? Math.round(completedParticipants / participantCount * 100) : 0,
      taskCount, targetType, targetTypeLabel:targetType === 'team' ? '团队' : '成员', targetCount:targetRows.length
    }
  }

  targetRows(evaluationId, targetType = '') {
    const typeFilter = targetType ? ' AND et.target_type = ?' : ''
    const params = targetType ? [evaluationId,targetType] : [evaluationId]
    return this.database.prepare(`
      SELECT et.target_type, et.target_id,
        e.payload_json AS employee_payload, e.status AS employee_status,
        e.department_id AS employee_department_id, e.team_id AS employee_team_id,
        d.name AS employee_department_name, t.name AS employee_team_name,
        t2.payload_json AS team_payload, t2.status AS team_status,
        t2.department_id AS team_department_id, d2.name AS team_department_name,
        (SELECT COUNT(*) FROM employees em WHERE em.team_id = t2.id AND em.status = 'active') AS member_count
      FROM evaluation_targets et
      LEFT JOIN employees e ON et.target_type = 'employee' AND e.id = et.target_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN teams t ON t.id = e.team_id
      LEFT JOIN teams t2 ON et.target_type = 'team' AND t2.id = et.target_id
      LEFT JOIN departments d2 ON d2.id = t2.department_id
      WHERE et.evaluation_id = ?${typeFilter} ORDER BY et.list_order
    `).all(...params).filter((row) => row.target_type === 'team' ? row.team_status === 'active' : row.employee_status === 'active')
  }

  listResults(session, evaluationId = '') {
    const evaluations = this.visibleEvaluationRows(session)
    const selected = evaluations.find((row) => row.id === evaluationId) || evaluations.at(-1)
    if (!selected) return { items:[], rules:[], activities:[] }
    const activity = this.evaluationView(selected)
    const targetType = activity.targetType
    const rules = this.database.prepare('SELECT payload_json FROM evaluation_rules WHERE evaluation_id = ? ORDER BY list_order').all(selected.id).map((row) => parseJson(row.payload_json))
    const targets = this.targetRows(selected.id,targetType)
    const aggregates = new Map(this.database.prepare(`
      SELECT target_type, target_id, COUNT(*) AS review_count, AVG(total) AS total
      FROM scores WHERE evaluation_id = ? GROUP BY target_type, target_id
    `).all(selected.id).map((row) => [`${row.target_type}:${row.target_id}`,row]))
    const values = new Map(this.database.prepare(`
      SELECT s.target_type, s.target_id, sv.rule_id, AVG(sv.value) AS average
      FROM scores s JOIN score_values sv ON sv.score_id = s.id
      WHERE s.evaluation_id = ? GROUP BY s.target_type, s.target_id, sv.rule_id
    `).all(selected.id).map((row) => [`${row.target_type}:${row.target_id}:${row.rule_id}`,row.average]))
    const items = targets.map((row) => {
      const key = `${row.target_type}:${row.target_id}`
      const aggregate = aggregates.get(key)
      const isTeam = row.target_type === 'team'
      const employee = parseJson(row.employee_payload)
      const team = parseJson(row.team_payload)
      const total = aggregate ? round(aggregate.total) : '--'
      return {
        id:row.target_id, targetType:row.target_type, name:isTeam ? team.name : employee.name,
        genderLabel:isTeam ? '' : employee.gender === 'female' ? '女' : employee.gender === 'male' ? '男' : '未知',
        departmentName:isTeam ? row.team_department_name || '' : row.employee_department_name || '',
        teamName:isTeam ? team.name || '' : row.employee_team_name || '', position:isTeam ? '' : employee.position || '',
        memberCount:isTeam ? Number(row.member_count || 0) : undefined,
        reviewCount:aggregate ? Number(aggregate.review_count) : 0,
        values:Object.fromEntries(rules.filter((rule) => rule.enabled).map((rule) => {
          const average = values.get(`${key}:${rule.id}`)
          return [rule.id, average === undefined ? '--' : round(average)]
        })), total
      }
    }).sort((a,b) => Number(b.total === '--' ? -1 : b.total) - Number(a.total === '--' ? -1 : a.total))
      .map((item,index) => ({...item,rank:item.total === '--' ? '--' : index + 1}))
    return {
      items, rules, targetType, activity,
      activities:evaluations.map((row) => {
        const view = this.evaluationView(row)
        return {id:view.id,name:view.name,code:view.code,targetType:view.targetType,teamId:view.teamId,teamName:view.teamName}
      })
    }
  }

  listTrendOptions(session) {
    const employeeScope = session.role === 'admin' ? '' : session.role === 'team_leader' ? ' WHERE e.team_id = ?' : ' WHERE e.department_id = ?'
    const value = session.role === 'team_leader' ? session.teamId : session.departmentId
    const employees = this.database.prepare(`
      SELECT e.id, e.name, e.status, e.payload_json, d.name AS department_name, t.name AS team_name
      FROM employees e JOIN departments d ON d.id = e.department_id JOIN teams t ON t.id = e.team_id${employeeScope} ORDER BY e.list_order
    `).all(...(employeeScope ? [value] : [])).map((row) => {
      const employee = parseJson(row.payload_json)
      return {id:row.id,name:employee.name,departmentName:row.department_name,teamName:row.team_name,status:row.status}
    })
    const teamScope = session.role === 'admin' ? '' : session.role === 'team_leader' ? ' WHERE t.id = ?' : ' WHERE t.department_id = ?'
    const teams = this.database.prepare(`
      SELECT t.id, t.name, t.department_id, t.status, d.name AS department_name
      FROM teams t JOIN departments d ON d.id = t.department_id${teamScope} ORDER BY t.list_order
    `).all(...(teamScope ? [value] : [])).map((row) => ({id:row.id,name:row.name,departmentId:row.department_id,departmentName:row.department_name,status:row.status}))
    return { employees, teams }
  }

  listTrends(session, { targetType, targetId, startTime = '', endTime = '' }) {
    const options = this.listTrendOptions(session)
    const target = targetType === 'team' ? options.teams.find((item) => item.id === targetId) : options.employees.find((item) => item.id === targetId)
    if (!target) return null
    const evaluations = this.visibleEvaluationRows(session)
    const start = startTime ? new Date(startTime).getTime() : null
    const end = endTime ? new Date(endTime).getTime() : null
    const aggregates = this.database.prepare(`
      SELECT evaluation_id, COUNT(*) AS review_count, AVG(total) AS total
      FROM scores WHERE target_type = ? AND target_id = ? GROUP BY evaluation_id
    `).all(targetType,targetId)
    const byEvaluation = new Map(aggregates.map((row) => [row.evaluation_id,row]))
    const points = evaluations.map((row) => {
      const evaluationTime = new Date(row.end_time).getTime()
      if ((start !== null && evaluationTime < start) || (end !== null && evaluationTime > end)) return null
      const aggregate = byEvaluation.get(row.id)
      if (!aggregate) return null
      const activity = this.evaluationView(row)
      return {
        activityId:row.id,activityName:row.name,periodId:row.period_id,periodName:row.period_name || '',
        evaluationTime:row.end_time,reviewCount:Number(aggregate.review_count),total:round(aggregate.total),
        status:row.status,startTime:row.start_time,endTime:row.end_time,archived:row.status === 'archived'
      }
    }).filter(Boolean).sort((a,b) => new Date(a.evaluationTime).getTime() - new Date(b.evaluationTime).getTime() || String(a.activityId).localeCompare(String(b.activityId)))
    return { targetType, target, points }
  }

  submitAtomic({ evaluationId, verifyId, taskId, score, task, verify, timedInvite }) {
    const updatedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const taskRow = this.database.prepare('SELECT status, evaluation_id, verification_code_id, payload_json FROM evaluation_tasks WHERE id = ?').get(taskId)
      if (!taskRow || taskRow.evaluation_id !== evaluationId || taskRow.verification_code_id !== verifyId) throw repositoryError('评价任务不存在', 'TASK_NOT_FOUND')
      if (taskRow.status === 'submitted') throw repositoryError('该评价对象已评价，不能重复提交')
      const existingScore = this.database.prepare('SELECT 1 FROM scores WHERE task_id = ?').get(taskId)
      if (existingScore) throw repositoryError('该评价对象已评价，不能重复提交')

      const nextOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM scores').get().value)
      const scorePayload = { ...score }
      delete scorePayload.values
      this.database.prepare(
        'INSERT INTO scores (id, evaluation_id, task_id, target_type, target_id, total, created_at, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(score.id, score.evaluationCodeId, score.taskId, score.targetType, score.targetId, Number(score.total), score.createdAt, json(scorePayload), nextOrder)

      const insertValue = this.database.prepare('INSERT INTO score_values (score_id, rule_id, value, list_order) VALUES (?, ?, ?, ?)')
      for (const [index, [ruleId, value]] of Object.entries(score.values || {}).entries()) insertValue.run(score.id, ruleId, Number(value), index)

      const taskPayload = { ...JSON.parse(taskRow.payload_json || '{}'), ...task, status: 'submitted' }
      this.database.prepare('UPDATE evaluation_tasks SET status = ?, payload_json = ? WHERE id = ? AND status = ?')
        .run('submitted', json(taskPayload), taskId, 'pending')

      const verifyRow = this.database.prepare('SELECT status, payload_json FROM verification_codes WHERE id = ? AND evaluation_id = ?').get(verifyId, evaluationId)
      if (!verifyRow) throw repositoryError('邀请码不存在', 'VERIFY_CODE_NOT_FOUND')
      const progress = this.database.prepare('SELECT COUNT(*) AS expected, SUM(CASE WHEN status = \'submitted\' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id = ?').get(verifyId)
      const expected = Number(progress.expected || 0)
      const submitted = Number(progress.submitted || 0)
      const remaining = Math.max(0, expected - submitted)
      const verifyPayload = { ...JSON.parse(verifyRow.payload_json || '{}'), ...verify, expected, submitted, remaining }
      if (expected > 0 && remaining === 0) {
        verifyPayload.status = 'completed'
        verifyPayload.completedAt ||= updatedAt
      } else {
        verifyPayload.status = verifyPayload.firstUsedAt ? 'in_progress' : 'unused'
        verifyPayload.completedAt = null
      }
      this.database.prepare('UPDATE verification_codes SET status = ?, payload_json = ? WHERE id = ?').run(verifyPayload.status, json(verifyPayload), verifyId)

      if (timedInvite) {
        const inviteRow = this.database.prepare('SELECT payload_json FROM timed_invites WHERE id = ? AND verification_code_id = ?').get(timedInvite.id, verifyId)
        if (inviteRow) {
          const invitePayload = { ...JSON.parse(inviteRow.payload_json || '{}'), ...timedInvite }
          this.database.prepare('UPDATE timed_invites SET status = ?, expires_at = ?, payload_json = ? WHERE id = ?')
            .run(invitePayload.status, invitePayload.expiresAt || null, json(invitePayload), timedInvite.id)
        }
      }
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(updatedAt)
      this.database.exec('COMMIT')
      return { expected, submitted, remaining }
    } catch (error) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw error
    }
  }
}
