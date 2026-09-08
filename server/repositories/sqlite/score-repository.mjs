import { AppError, json, parseJson, transaction, touch } from './common.mjs'
import { appendAuditRecord } from './audit-repository.mjs'
import { activityStatus } from '../../domain/activity.mjs'
const round = (value) => Math.round(Number(value)*10)/10
const conflict = (message, code = 'TASK_ALREADY_SUBMITTED') => new AppError(message,409,code)

function scope(session, alias = 'e') {
  if (session.role === 'admin') return {sql:'',params:[]}
  if (session.role === 'team_leader') return {sql:` AND ${alias}.team_id=?`,params:[session.teamId]}
  if (session.role === 'leader') return {sql:` AND ${alias}.department_id=?`,params:[session.departmentId]}
  throw new AppError('当前账号没有此操作权限',403,'FORBIDDEN')
}
function grouped(rows, key, map = (row) => row) {
  const result = new Map()
  for (const row of rows) { if (!result.has(row[key])) result.set(row[key],[]); result.get(row[key]).push(map(row)) }
  return result
}

export class SqliteScoreRepository {
  constructor(storage) { if (!storage?.database) throw new Error('SqliteScoreRepository requires relational storage'); this.database = storage.database }
  create(input) { return this.submitAtomic(input) }
  findUser(id) {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(id)
    return row ? {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''} : null
  }
  visibleEvaluationRows(session) {
    const access = scope(session)
    return this.database.prepare(`SELECT e.*,t.name AS team_name,d.name AS department_name,p.name AS period_name FROM evaluation_activities e JOIN teams t ON t.id=e.team_id JOIN departments d ON d.id=e.department_id LEFT JOIN review_periods p ON p.id=e.period_id WHERE 1=1${access.sql} ORDER BY e.list_order`).all(...access.params)
  }
  evaluationViews(rows) {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const where = `evaluation_id IN (${ids.map(() => '?').join(',')})`
    const targets = grouped(this.database.prepare(`SELECT evaluation_id,target_type,target_id FROM evaluation_targets WHERE ${where} ORDER BY list_order`).all(...ids),'evaluation_id')
    const rules = grouped(this.database.prepare(`SELECT evaluation_id,payload_json FROM evaluation_rules WHERE ${where} ORDER BY list_order`).all(...ids),'evaluation_id',(row) => parseJson(row.payload_json))
    const participants = grouped(this.database.prepare(`SELECT evaluation_id,employee_id FROM evaluation_participants WHERE ${where} ORDER BY list_order`).all(...ids),'evaluation_id',(row) => row.employee_id)
    const verifies = new Map(this.database.prepare(`SELECT evaluation_id,COUNT(*) AS expected,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM verification_codes WHERE ${where} GROUP BY evaluation_id`).all(...ids).map((row) => [row.evaluation_id,row]))
    const tasks = new Map(this.database.prepare(`SELECT evaluation_id,COUNT(*) AS value FROM evaluation_tasks WHERE ${where} GROUP BY evaluation_id`).all(...ids).map((row) => [row.evaluation_id,Number(row.value)]))
    return rows.map((row) => {
      const payload = parseJson(row.payload_json)
      const targetRows = targets.get(row.id) || []
      const targetType = targetRows[0]?.target_type || payload.targetType || 'employee'
      const participantCount = Number(verifies.get(row.id)?.expected || 0)
      const completedParticipants = Number(verifies.get(row.id)?.completed || 0)
      return {
        ...payload,id:row.id,code:row.code,linkCode:row.link_code,name:row.name,periodId:row.period_id,departmentId:row.department_id,teamId:row.team_id,
        status:row.status,lifecycleStatus:row.status,startTime:row.start_time,endTime:row.end_time,periodName:row.period_name || '',teamName:row.team_name || '',departmentName:row.department_name || '',
        rules:rules.get(row.id) || [],participantEmployeeIds:participants.get(row.id) || [],targetEmployeeIds:targetRows.filter((target) => target.target_type === 'employee').map((target) => target.target_id),targetTeamIds:targetRows.filter((target) => target.target_type === 'team').map((target) => target.target_id),
        participantCount,completedParticipants,pendingParticipants:Math.max(0,participantCount-completedParticipants),completionRate:participantCount ? Math.round(completedParticipants/participantCount*100) : 0,
        taskCount:tasks.get(row.id) || 0,targetType,targetTypeLabel:targetType === 'team' ? '团队' : '成员',targetCount:targetRows.length
      }
    })
  }
  evaluationView(row) { return this.evaluationViews([row])[0] }
  listActivities(session) {
    const items = this.evaluationViews(this.visibleEvaluationRows(session)).map((item) => ({...item,status:activityStatus(item)})).sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return {items,canWrite:['admin','team_leader'].includes(session.role)}
  }
  targetRows(evaluationId, type = '') {
    return this.database.prepare(`WITH all_targets AS (
      SELECT target_type,target_id,list_order FROM evaluation_targets WHERE evaluation_id=?
      UNION ALL SELECT target_type,target_id,2147483647 AS list_order FROM scores WHERE evaluation_id=?
    ), selected AS (SELECT target_type,target_id,MIN(list_order) AS list_order FROM all_targets GROUP BY target_type,target_id)
    SELECT et.*,e.payload_json AS employee_payload,e.status AS employee_status,e.department_id AS employee_department_id,e.team_id AS employee_team_id,
      d.name AS employee_department_name,t.name AS employee_team_name,t2.payload_json AS team_payload,t2.status AS team_status,t2.department_id AS team_department_id,d2.name AS team_department_name,
      (SELECT COUNT(*) FROM employees em WHERE em.team_id=t2.id AND em.status='active') AS member_count,
      (SELECT s.payload_json FROM scores s WHERE s.evaluation_id=? AND s.target_type=et.target_type AND s.target_id=et.target_id ORDER BY s.list_order LIMIT 1) AS historical_score_payload
    FROM selected et LEFT JOIN employees e ON et.target_type='employee' AND e.id=et.target_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN teams t ON t.id=e.team_id
    LEFT JOIN teams t2 ON et.target_type='team' AND t2.id=et.target_id LEFT JOIN departments d2 ON d2.id=t2.department_id
    WHERE (?='' OR et.target_type=?) ORDER BY et.list_order,et.target_id`).all(evaluationId,evaluationId,evaluationId,type,type)
      .filter((row) => row.target_type === 'team' ? row.team_payload !== null : row.employee_payload !== null)
  }
  listResults(session, evaluationId = '') {
    const evaluations = this.visibleEvaluationRows(session)
    const selected = evaluations.find((row) => row.id === evaluationId) || evaluations.at(-1)
    if (!selected) return {items:[],rules:[],activities:[]}
    const activity = this.evaluationView(selected)
    const rules = activity.rules
    const aggregates = new Map(this.database.prepare('SELECT target_type,target_id,COUNT(*) AS review_count,AVG(total) AS total FROM scores WHERE evaluation_id=? GROUP BY target_type,target_id').all(selected.id).map((row) => [`${row.target_type}:${row.target_id}`,row]))
    const values = new Map(this.database.prepare('SELECT s.target_type,s.target_id,sv.rule_id,AVG(sv.value) AS average FROM scores s JOIN score_values sv ON sv.score_id=s.id WHERE s.evaluation_id=? GROUP BY s.target_type,s.target_id,sv.rule_id').all(selected.id).map((row) => [`${row.target_type}:${row.target_id}:${row.rule_id}`,row.average]))
    const items = this.targetRows(selected.id,activity.targetType).map((row) => {
      const key = `${row.target_type}:${row.target_id}`
      const aggregate = aggregates.get(key)
      const isTeam = row.target_type === 'team'
      const current = parseJson(isTeam ? row.team_payload : row.employee_payload)
      const snapshot = parseJson(row.historical_score_payload).targetSnapshot || {}
      const gender = snapshot.gender || current.gender
      return {
        id:row.target_id,targetType:row.target_type,name:snapshot.name || current.name,
        status:isTeam ? row.team_status : row.employee_status,
        genderLabel:isTeam ? '' : gender === 'female' ? '女' : gender === 'male' ? '男' : '未知',
        departmentName:snapshot.departmentName ?? (isTeam ? row.team_department_name : row.employee_department_name) ?? '',
        teamName:snapshot.teamName ?? (isTeam ? current.name : row.employee_team_name) ?? '',position:isTeam ? '' : snapshot.position ?? current.position ?? '',
        memberCount:isTeam ? Number(row.member_count || 0) : undefined,reviewCount:Number(aggregate?.review_count || 0),
        values:Object.fromEntries(rules.filter((rule) => rule.enabled).map((rule) => { const value = values.get(`${key}:${rule.id}`); return [rule.id,value === undefined ? '--' : round(value)] })),
        total:aggregate ? round(aggregate.total) : '--'
      }
    }).sort((a,b) => (b.total === '--' ? -Infinity : b.total)-(a.total === '--' ? -Infinity : a.total) || a.id.localeCompare(b.id)).map((item,index) => ({...item,rank:item.total === '--' ? '--' : index+1}))
    return {items,rules,targetType:activity.targetType,activity,activities:evaluations.map((row) => ({id:row.id,name:row.name,code:row.code,targetType:parseJson(row.payload_json).targetType || 'employee',teamId:row.team_id,teamName:row.team_name || ''}))}
  }
  listTrendOptions(session) {
    const access = scope(session)
    const employees = this.database.prepare(`SELECT e.id,e.name,e.status,d.name AS department_name,t.name AS team_name FROM employees e JOIN departments d ON d.id=e.department_id JOIN teams t ON t.id=e.team_id WHERE 1=1${access.sql} ORDER BY e.list_order`).all(...access.params)
      .map((row) => ({id:row.id,name:row.name,status:row.status,departmentName:row.department_name,teamName:row.team_name}))
    const teamWhere = session.role === 'admin' ? '' : session.role === 'team_leader' ? ' AND t.id=?' : ' AND t.department_id=?'
    const teams = this.database.prepare(`SELECT t.*,d.name AS department_name FROM teams t JOIN departments d ON d.id=t.department_id WHERE 1=1${teamWhere} ORDER BY t.list_order`).all(...(session.role === 'admin' ? [] : [session.role === 'team_leader' ? session.teamId : session.departmentId]))
      .map((row) => ({id:row.id,name:row.name,departmentId:row.department_id,departmentName:row.department_name,status:row.status}))
    return {employees,teams}
  }
  listTrends(session, {targetType,targetId,startTime = '',endTime = ''}) {
    const options = this.listTrendOptions(session)
    const target = (targetType === 'team' ? options.teams : options.employees).find((item) => item.id === targetId)
    if (!target) return null
    const access = scope(session)
    const rows = this.database.prepare(`SELECT e.id,e.name,e.period_id,p.name AS period_name,e.start_time,e.end_time,e.status,COUNT(*) AS review_count,AVG(s.total) AS total
      FROM scores s JOIN evaluation_activities e ON e.id=s.evaluation_id LEFT JOIN review_periods p ON p.id=e.period_id
      WHERE s.target_type=? AND s.target_id=?${access.sql} GROUP BY e.id ORDER BY e.end_time,e.id`).all(targetType,targetId,...access.params)
    const start = startTime ? Date.parse(startTime) : -Infinity
    const end = endTime ? Date.parse(endTime) : Infinity
    const points = rows.filter((row) => Date.parse(row.end_time) >= start && Date.parse(row.end_time) <= end).map((row) => ({activityId:row.id,activityName:row.name,periodId:row.period_id,periodName:row.period_name || '',evaluationTime:row.end_time,reviewCount:Number(row.review_count),total:round(row.total),status:row.status,startTime:row.start_time,endTime:row.end_time,archived:row.status === 'archived'}))
    return {targetType,target,points}
  }
  submitAtomic({evaluationId,verifyId,taskId,score,task,verify,timedInvite}, {transactionOpen = false} = {}) {
    const write = () => {
      const row = this.database.prepare('SELECT status,evaluation_id,verification_code_id,payload_json FROM evaluation_tasks WHERE id=?').get(taskId)
      if (!row || row.evaluation_id !== evaluationId || row.verification_code_id !== verifyId) throw conflict('评价任务不存在','TASK_NOT_FOUND')
      if (row.status !== 'pending' || this.database.prepare('SELECT 1 FROM scores WHERE task_id=?').get(taskId)) throw conflict('该评价对象已评价，不能重复提交')
      const now = new Date().toISOString()
      const {values,...payload} = score
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM scores').get().value)
      this.database.prepare('INSERT INTO scores (id,evaluation_id,task_id,target_type,target_id,total,created_at,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(score.id,evaluationId,taskId,score.targetType,score.targetId,Number(score.total),score.createdAt,json(payload),order)
      const insertValue = this.database.prepare('INSERT INTO score_values VALUES (?,?,?,?)')
      Object.entries(values || {}).forEach(([id,value],index) => insertValue.run(score.id,id,Number(value),index))
      const changed = this.database.prepare("UPDATE evaluation_tasks SET status='submitted',payload_json=? WHERE id=? AND status='pending'").run(json({...parseJson(row.payload_json),...task,status:'submitted'}),taskId)
      if (Number(changed.changes) !== 1) throw conflict('评价任务已更新')
      const verifyRow = this.database.prepare('SELECT payload_json FROM verification_codes WHERE id=? AND evaluation_id=?').get(verifyId,evaluationId)
      if (!verifyRow) throw conflict('邀请码不存在','VERIFY_CODE_NOT_FOUND')
      const progress = this.database.prepare("SELECT COUNT(*) AS expected,SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted FROM evaluation_tasks WHERE verification_code_id=?").get(verifyId)
      const expected = Number(progress.expected || 0), submitted = Number(progress.submitted || 0), remaining = Math.max(0,expected-submitted)
      const nextVerify = {...parseJson(verifyRow.payload_json),...verify,expected,submitted,remaining}
      nextVerify.status = expected > 0 && remaining === 0 ? 'completed' : nextVerify.firstUsedAt ? 'in_progress' : 'unused'
      nextVerify.completedAt = nextVerify.status === 'completed' ? nextVerify.completedAt || now : null
      this.database.prepare('UPDATE verification_codes SET status=?,payload_json=? WHERE id=?').run(nextVerify.status,json(nextVerify),verifyId)
      if (timedInvite) {
        const inviteRow = this.database.prepare('SELECT payload_json FROM timed_invites WHERE id=? AND verification_code_id=?').get(timedInvite.id,verifyId)
        if (inviteRow) {
          const nextInvite = {...parseJson(inviteRow.payload_json),...timedInvite}
          if (remaining === 0) { nextInvite.status = 'completed'; nextInvite.completedAt ||= now }
          this.database.prepare('UPDATE timed_invites SET status=?,expires_at=?,payload_json=? WHERE id=?').run(nextInvite.status,nextInvite.expiresAt || null,json(nextInvite),timedInvite.id)
        }
      }
      // Audit business activity without a stable score-id -> task-id link.
      appendAuditRecord(this.database,'score.submit',{evaluationId,targetType:score.targetType,targetId:score.targetId},{},now)
      touch(this.database,now)
      return {expected,submitted,remaining,completed:remaining === 0}
    }
    return transactionOpen ? write() : transaction(this.database,write)
  }
}
