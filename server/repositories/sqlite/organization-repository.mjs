import { randomBytes } from 'node:crypto'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const randomId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })

export class SqliteOrganizationRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteOrganizationRepository requires relational storage')
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  visibleTeamIds(session) {
    if (session.role === 'admin') return new Set(this.database.prepare("SELECT id FROM teams WHERE status != 'inactive'").all().map((row) => row.id))
    if (session.role === 'team_leader') return new Set([session.teamId])
    if (session.role === 'leader') return new Set(this.database.prepare("SELECT id FROM teams WHERE department_id=? AND status != 'inactive'").all(session.departmentId).map((row) => row.id))
    return new Set()
  }

  list(kind, session) {
    const teamIds = this.visibleTeamIds(session)
    const departments = this.database.prepare('SELECT id,name,status,payload_json FROM departments ORDER BY list_order').all().map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,status:row.status}))
    const teams = this.database.prepare('SELECT t.id,t.name,t.department_id,t.status,t.payload_json,d.name AS department_name FROM teams t JOIN departments d ON d.id=t.department_id ORDER BY t.list_order').all().filter((row) => teamIds.has(row.id)).map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,departmentId:row.department_id,status:row.status,departmentName:row.department_name}))
    const departmentIds = new Set(teams.map((team) => team.departmentId))
    const visibleDepartments = session.role === 'admin' ? departments : departments.filter((department) => departmentIds.has(department.id))
    return {items:kind === 'teams' ? teams : visibleDepartments,departments:visibleDepartments,canWrite:session.role === 'admin'}
  }

  create(kind, input, session) {
    if (session.role !== 'admin') throw appError('只有管理员可以新增组织',403,'FORBIDDEN')
    const name = String(input.name || '').trim()
    if (!name) throw appError('名称不能为空')
    if (kind === 'teams' && !this.database.prepare('SELECT 1 FROM departments WHERE id=?').get(input.departmentId)) throw appError('所属部门不存在')
    const now = new Date().toISOString()
    const item = {...input,id:randomId(kind === 'teams' ? 'team' : 'dep'),name,status:input.status === 'inactive' ? 'inactive' : 'active',createdAt:now,updatedAt:now}
    const table = kind === 'teams' ? 'teams' : 'departments'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const order = Number(this.database.prepare(`SELECT COALESCE(MAX(list_order)+1,0) AS value FROM ${table}`).get().value)
      if (kind === 'teams') this.database.prepare('INSERT INTO teams (id,department_id,name,status,sort_value,payload_json,list_order) VALUES (?,?,?,?,?,?,?)').run(item.id,item.departmentId,item.name,item.status,item.sort || null,json(item),order)
      else this.database.prepare('INSERT INTO departments (id,name,status,sort_value,payload_json,list_order) VALUES (?,?,?,?,?,?)').run(item.id,item.name,item.status,item.sort || null,json(item),order)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(now)
      this.database.exec('COMMIT'); return item
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  update(kind, id, input, session) {
    if (session.role !== 'admin') throw appError('只有管理员可以编辑组织',403,'FORBIDDEN')
    const table = kind === 'teams' ? 'teams' : 'departments'
    const row = this.database.prepare(`SELECT payload_json,name,status${kind === 'teams' ? ',department_id' : ''} FROM ${table} WHERE id=?`).get(id)
    if (!row) throw appError('记录不存在',404,'NOT_FOUND')
    if (kind === 'teams' && !this.database.prepare('SELECT 1 FROM departments WHERE id=?').get(input.departmentId || row.department_id)) throw appError('所属部门不存在')
    const previous = parseJson(row.payload_json)
    const next = {...previous,...input,id,name:String(input.name || row.name).trim() || row.name,status:input.status === 'inactive' ? 'inactive' : 'active',updatedAt:new Date().toISOString()}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (kind === 'teams') {
        const departmentId = input.departmentId || row.department_id
        this.database.prepare('UPDATE teams SET department_id=?,name=?,status=?,sort_value=?,payload_json=? WHERE id=?').run(departmentId,next.name,next.status,next.sort || null,json({...next,departmentId}),id)
        if (departmentId !== row.department_id) {
          this.database.prepare('UPDATE employees SET department_id=?,payload_json=json_set(payload_json,\'$.departmentId\',?) WHERE team_id=?').run(departmentId,departmentId,id)
          this.database.prepare('UPDATE evaluation_activities SET department_id=?,payload_json=json_set(payload_json,\'$.departmentId\',?) WHERE team_id=?').run(departmentId,departmentId,id)
          this.database.prepare('UPDATE users SET department_id=?,payload_json=json_set(payload_json,\'$.departmentId\',?) WHERE team_id=?').run(departmentId,departmentId,id)
          next.departmentId = departmentId
        }
      } else this.database.prepare('UPDATE departments SET name=?,status=?,sort_value=?,payload_json=? WHERE id=?').run(next.name,next.status,next.sort || null,json(next),id)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(next.updatedAt)
      this.database.exec('COMMIT'); return next
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  delete(kind, id, session) {
    if (session.role !== 'admin') throw appError('只有管理员可以删除组织',403,'FORBIDDEN')
    const table = kind === 'teams' ? 'teams' : 'departments'
    if (!this.database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) throw appError('记录不存在',404,'NOT_FOUND')
    if (kind === 'departments') {
      if (this.database.prepare('SELECT 1 FROM teams WHERE department_id=? LIMIT 1').get(id) || this.database.prepare('SELECT 1 FROM employees WHERE department_id=? LIMIT 1').get(id) || this.database.prepare('SELECT 1 FROM users WHERE department_id=? LIMIT 1').get(id)) throw appError('该部门仍被团队、成员或账号使用，不能删除',409)
    } else if (this.database.prepare('SELECT 1 FROM employees WHERE team_id=? LIMIT 1').get(id) || this.database.prepare('SELECT 1 FROM evaluation_activities WHERE team_id=? LIMIT 1').get(id) || this.database.prepare('SELECT 1 FROM users WHERE team_id=? LIMIT 1').get(id) || this.database.prepare("SELECT 1 FROM evaluation_tasks WHERE target_type='team' AND target_id=? LIMIT 1").get(id) || this.database.prepare("SELECT 1 FROM scores WHERE target_type='team' AND target_id=? LIMIT 1").get(id)) throw appError('该团队仍被成员、活动、评价任务、评分或账号使用，不能删除',409)
    this.database.exec('BEGIN IMMEDIATE')
    try { this.database.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(new Date().toISOString()); this.database.exec('COMMIT'); return {deleted:true} }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }
}
