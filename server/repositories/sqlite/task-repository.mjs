const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)

export class SqliteTaskRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteTaskRepository requires relational storage')
    this.database = storage.database
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

    const progress = this.database.prepare(`
      SELECT COUNT(*) AS expected,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted
      FROM evaluation_tasks WHERE verification_code_id = ?
    `).get(verifyId)
    const expected = Number(progress.expected || 0)
    const submitted = Number(progress.submitted || 0)
    const remaining = Math.max(0, expected - submitted)

    let timedInvite = null
    if (timedInviteId) {
      const inviteRow = this.database.prepare(`
        SELECT id, evaluation_id, verification_code_id, status, expires_at, payload_json
        FROM timed_invites WHERE id = ? AND evaluation_id = ? AND verification_code_id = ?
      `).get(timedInviteId, evaluationId, verifyId)
      if (inviteRow) {
        timedInvite = {
          ...parseJson(inviteRow.payload_json), id:inviteRow.id, evaluationCodeId:inviteRow.evaluation_id,
          verifyCodeId:inviteRow.verification_code_id, status:inviteRow.status, expiresAt:inviteRow.expires_at
        }
      }
    }

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
