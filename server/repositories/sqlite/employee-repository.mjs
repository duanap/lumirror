import { randomBytes } from 'node:crypto'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const randomId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })
const AVATAR_GENDERS = new Map([
  ['avatar_male_young_plain','male'],['avatar_male_young_glasses','male'],['avatar_male_adult_plain','male'],['avatar_male_adult_glasses','male'],
  ['avatar_female_young_plain','female'],['avatar_female_young_glasses','female'],['avatar_female_adult_plain','female'],['avatar_female_adult_glasses','female']
])

export class SqliteEmployeeRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteEmployeeRepository requires relational storage')
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id, username, role, status, department_id, team_id, employee_id, payload_json FROM users WHERE id = ?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  visibleTeamIds(session) {
    if (session.role === 'admin') return new Set(this.database.prepare("SELECT id FROM teams WHERE status != 'inactive'").all().map((row) => row.id))
    if (session.role === 'team_leader') return new Set([session.teamId])
    if (session.role === 'leader') return new Set(this.database.prepare("SELECT id FROM teams WHERE department_id = ? AND status != 'inactive'").all(session.departmentId).map((row) => row.id))
    const employee = this.database.prepare('SELECT team_id FROM employees WHERE id = ?').get(session.employeeId)
    return new Set(employee?.team_id ? [employee.team_id] : [])
  }

  tagsFor(employeeId) {
    const ids = this.database.prepare('SELECT tag_id FROM employee_tags WHERE employee_id = ? ORDER BY list_order').all(employeeId).map((row) => row.tag_id)
    const tags = ids.length ? this.database.prepare(`SELECT id,name,payload_json FROM member_tags WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []
    const byId = new Map(tags.map((row) => [row.id,{...parseJson(row.payload_json),id:row.id,name:row.name}]))
    return {tagIds:ids,tags:ids.map((id) => byId.get(id)).filter(Boolean)}
  }

  view(row) {
    return {...parseJson(row.payload_json),id:row.id,departmentId:row.department_id,teamId:row.team_id,name:row.name,status:row.status,departmentName:row.department_name || '',teamName:row.team_name || '',...this.tagsFor(row.id)}
  }

  list(session, filters = {}) {
    const teamIds = this.visibleTeamIds(session)
    const employees = this.database.prepare(`
      SELECT e.id,e.department_id,e.team_id,e.name,e.status,e.payload_json,d.name AS department_name,t.name AS team_name
      FROM employees e JOIN departments d ON d.id=e.department_id JOIN teams t ON t.id=e.team_id ORDER BY e.list_order
    `).all().filter((row) => teamIds.has(row.team_id))
    const q = String(filters.q || '').trim().toLowerCase()
    const items = employees.map((row) => this.view(row)).filter((item) => {
      if (q && ![item.name,item.position,item.teamName,item.departmentName].some((value) => String(value || '').toLowerCase().includes(q))) return false
      if (filters.teamId && item.teamId !== filters.teamId) return false
      if (filters.departmentId && item.departmentId !== filters.departmentId) return false
      if (filters.status && item.status !== filters.status) return false
      return true
    })
    const allowedTeams = this.database.prepare("SELECT t.id,t.name,t.department_id,t.status,d.name AS department_name FROM teams t JOIN departments d ON d.id=t.department_id WHERE t.status != 'inactive' ORDER BY t.list_order").all().filter((row) => teamIds.has(row.id))
    const departmentIds = new Set(allowedTeams.map((team) => team.department_id))
    const departments = this.database.prepare('SELECT id,name,status,payload_json FROM departments ORDER BY list_order').all().filter((row) => departmentIds.has(row.id)).map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,status:row.status}))
    const tags = this.database.prepare('SELECT id,name,payload_json FROM member_tags ORDER BY list_order').all().map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,memberCount:Number(this.database.prepare('SELECT COUNT(*) AS value FROM employee_tags et JOIN employees e ON e.id=et.employee_id WHERE et.tag_id=? AND e.team_id IN (' + [...teamIds].map(() => '?').join(',') + ')').get(row.id,...teamIds).value || 0)}))
    return {items,options:{departments,teams:allowedTeams.map((row) => ({id:row.id,name:row.name,departmentId:row.department_id,status:row.status,departmentName:row.department_name})),tags},canWrite:session.role === 'admin' || session.role === 'team_leader',canManageTags:session.role === 'admin'}
  }

  normalizeAvatar(value, gender) {
    const avatar = String(value || '').trim()
    return AVATAR_GENDERS.get(avatar) === gender ? avatar : ''
  }

  create(input, session) {
    const team = this.database.prepare('SELECT id,department_id,status FROM teams WHERE id=?').get(input.teamId)
    if (!team || team.status === 'inactive' || !this.visibleTeamIds(session).has(team.id)) throw appError('所属团队无效')
    if (team.department_id !== input.departmentId) throw appError('所属部门与团队不一致')
    const name = String(input.name || '').trim()
    if (!name) throw appError('员工姓名不能为空')
    const gender = ['male','female','unknown'].includes(input.gender) ? input.gender : 'unknown'
    const now = new Date().toISOString()
    const employee = {name,gender,departmentId:team.department_id,teamId:team.id,position:String(input.position || ''),status:input.status === 'inactive' ? 'inactive' : 'active',avatar:this.normalizeAvatar(input.avatar,gender),tagIds:[],createdAt:now,updatedAt:now}
    const validTagIds = this.validTagIds(input.tagIds)
    employee.tagIds = validTagIds
    employee.id = randomId('emp')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM employees').get().value)
      const payload = {...employee}; delete payload.tagIds
      this.database.prepare('INSERT INTO employees (id,department_id,team_id,name,status,payload_json,list_order) VALUES (?,?,?,?,?,?,?)').run(employee.id,employee.departmentId,employee.teamId,employee.name,employee.status,json(payload),order)
      const tagInsert = this.database.prepare('INSERT INTO employee_tags (employee_id,tag_id,list_order) VALUES (?,?,?)')
      validTagIds.forEach((tagId,index) => tagInsert.run(employee.id,tagId,index))
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(now)
      this.database.exec('COMMIT')
      return employee
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  validTagIds(values) {
    const ids = [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))]
    const valid = new Set(this.database.prepare(`SELECT id FROM member_tags WHERE id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`).all(...ids).map((row) => row.id))
    return ids.filter((id) => valid.has(id))
  }

  update(employeeId, input, session) {
    const row = this.database.prepare('SELECT e.id,e.department_id,e.team_id,e.name,e.status,e.payload_json FROM employees e WHERE e.id=?').get(employeeId)
    if (!row || !this.visibleTeamIds(session).has(row.team_id)) throw appError('员工不存在或无权编辑',404,'NOT_FOUND')
    const team = this.database.prepare('SELECT id,department_id,status FROM teams WHERE id=?').get(input.teamId || row.team_id)
    if (!team || team.status === 'inactive' || !this.visibleTeamIds(session).has(team.id)) throw appError('所属团队无效')
    if ((input.departmentId || row.department_id) !== team.department_id) throw appError('所属部门与团队不一致')
    const previous = {...parseJson(row.payload_json),id:row.id,name:row.name,departmentId:row.department_id,teamId:row.team_id,status:row.status}
    const gender = ['male','female','unknown'].includes(input.gender) ? input.gender : previous.gender || 'unknown'
    const next = {...previous,...input,id:employeeId,departmentId:team.department_id,teamId:team.id,name:String(input.name || previous.name).trim(),gender,avatar:this.normalizeAvatar(input.avatar ?? previous.avatar,gender),tagIds:this.validTagIds(input.tagIds ?? this.tagsFor(employeeId).tagIds),updatedAt:new Date().toISOString()}
    delete next.employeeNo; delete next.phone; delete next.tags
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const payload = {...next}; delete payload.tagIds
      this.database.prepare('UPDATE employees SET department_id=?,team_id=?,name=?,status=?,payload_json=? WHERE id=?').run(next.departmentId,next.teamId,next.name,next.status,json(payload),employeeId)
      this.database.prepare('DELETE FROM employee_tags WHERE employee_id=?').run(employeeId)
      const tagInsert = this.database.prepare('INSERT INTO employee_tags (employee_id,tag_id,list_order) VALUES (?,?,?)')
      next.tagIds.forEach((tagId,index) => tagInsert.run(employeeId,tagId,index))
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(next.updatedAt)
      this.database.exec('COMMIT')
      return next
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  delete(employeeId, session) {
    const row = this.database.prepare('SELECT id,team_id FROM employees WHERE id=?').get(employeeId)
    if (!row || !this.visibleTeamIds(session).has(row.team_id)) throw appError('员工不存在或无权删除',404,'NOT_FOUND')
    if (this.database.prepare("SELECT 1 FROM scores WHERE target_type='employee' AND target_id=? LIMIT 1").get(employeeId)) throw appError('该员工已有历史评分，不能删除，请改为停用',409)
    if (this.database.prepare("SELECT 1 FROM verification_codes WHERE participant_employee_id=? AND EXISTS (SELECT 1 FROM evaluation_tasks WHERE evaluation_tasks.verification_code_id=verification_codes.id AND evaluation_tasks.status='submitted') LIMIT 1").get(employeeId)) throw appError('该员工已有评价提交记录，不能删除，请改为停用',409)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM evaluation_targets WHERE target_type=\'employee\' AND target_id=?').run(employeeId)
      this.database.prepare('DELETE FROM evaluation_participants WHERE employee_id=?').run(employeeId)
      this.database.prepare('DELETE FROM evaluation_tasks WHERE target_type=\'employee\' AND target_id=? AND status=\'pending\'').run(employeeId)
      this.database.prepare('UPDATE users SET employee_id=NULL,payload_json=json_set(payload_json,\'$.employeeId\',\'\') WHERE employee_id=?').run(employeeId)
      this.database.prepare('DELETE FROM employees WHERE id=?').run(employeeId)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return {deleted:true}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  listTags(session) {
    const teamIds = this.visibleTeamIds(session)
    const placeholders = [...teamIds].map(() => '?').join(',') || "''"
    return this.database.prepare('SELECT t.id,t.name,t.payload_json,COUNT(CASE WHEN e.id IS NOT NULL THEN 1 END) AS member_count FROM member_tags t LEFT JOIN employee_tags et ON et.tag_id=t.id LEFT JOIN employees e ON e.id=et.employee_id AND e.team_id IN (' + placeholders + ') GROUP BY t.id ORDER BY t.list_order').all(...teamIds).map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,memberCount:Number(row.member_count || 0)}))
  }

  createTag(input, session) {
    if (session.role !== 'admin' && session.role !== 'team_leader') throw appError('当前账号没有此操作权限',403,'FORBIDDEN')
    const name = String(input.name || '').trim().replace(/\s+/g,' ')
    if (!name || name.length > 20) throw appError('标签名称需为 1-20 个字符')
    if (this.database.prepare('SELECT 1 FROM member_tags WHERE lower(name)=lower(?)').get(name)) throw appError('标签名称已存在',409)
    const tag = {id:randomId('tag'),name,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM member_tags').get().value)
      this.database.prepare('INSERT INTO member_tags (id,name,payload_json,list_order) VALUES (?,?,?,?)').run(tag.id,tag.name,json(tag),order)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(tag.updatedAt)
      this.database.exec('COMMIT'); return {...tag,memberCount:0}
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  updateTag(tagId, input, session) {
    if (session.role !== 'admin') throw appError('只有管理员可以重命名成员标签',403,'FORBIDDEN')
    const row = this.database.prepare('SELECT payload_json FROM member_tags WHERE id=?').get(tagId)
    if (!row) throw appError('成员标签不存在',404,'NOT_FOUND')
    const name = String(input.name || '').trim().replace(/\s+/g,' ')
    if (!name || name.length > 20) throw appError('标签名称需为 1-20 个字符')
    if (this.database.prepare('SELECT 1 FROM member_tags WHERE lower(name)=lower(?) AND id != ?').get(name,tagId)) throw appError('标签名称已存在',409)
    const next = {...parseJson(row.payload_json),id:tagId,name,updatedAt:new Date().toISOString()}
    this.database.prepare('UPDATE member_tags SET name=?,payload_json=? WHERE id=?').run(name,json(next),tagId)
    return next
  }

  deleteTag(tagId, session) {
    if (session.role !== 'admin') throw appError('只有管理员可以删除成员标签',403,'FORBIDDEN')
    if (!this.database.prepare('SELECT 1 FROM member_tags WHERE id=?').get(tagId)) throw appError('成员标签不存在',404,'NOT_FOUND')
    const detachedCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM employee_tags WHERE tag_id=?').get(tagId).value || 0)
    this.database.exec('BEGIN IMMEDIATE')
    try { this.database.prepare('DELETE FROM member_tags WHERE id=?').run(tagId); this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString()); this.database.exec('COMMIT'); return {deleted:true,detachedCount} }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }
}
