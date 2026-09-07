const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)

export class SqliteAuditRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteAuditRepository requires relational storage')
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  list(session, filters = {}) {
    if (session.role !== 'admin') throw Object.assign(new Error('只有管理员可以查看操作日志'),{status:403,code:'FORBIDDEN'})
    const clauses = []
    const params = []
    if (filters.action) { clauses.push('action = ?'); params.push(filters.action) }
    if (filters.actorId) { clauses.push('actor_id = ?'); params.push(filters.actorId) }
    if (filters.role) { clauses.push('role = ?'); params.push(filters.role) }
    if (filters.startTime) { clauses.push('created_at >= ?'); params.push(filters.startTime) }
    if (filters.endTime) { clauses.push('created_at <= ?'); params.push(filters.endTime) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.min(200,Math.max(1,Number(filters.limit) || 80))
    const offset = Math.max(0,Number(filters.offset) || 0)
    const rows = this.database.prepare(`SELECT payload_json FROM audit_logs ${where} ORDER BY list_order DESC LIMIT ? OFFSET ?`).all(...params,limit,offset)
    return {items:rows.map((row) => parseJson(row.payload_json))}
  }

  append(action, detail = {}, actor = {}) {
    const createdAt = new Date().toISOString()
    const id = `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const payload = {id,action,actorId:actor.userId || '',actorName:actor.username || '',role:actor.role || '',detail,createdAt}
    const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM audit_logs').get().value)
    this.database.prepare('INSERT INTO audit_logs (id,action,actor_id,role,created_at,detail_json,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?)').run(id,action,actor.userId || null,actor.role || null,createdAt,JSON.stringify(detail),JSON.stringify(payload),order)
    return payload
  }
}
