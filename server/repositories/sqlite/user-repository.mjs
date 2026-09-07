import { randomBytes, pbkdf2Sync, createHash } from 'node:crypto'
import { appendAuditRecord } from './audit-repository.mjs'
import { currentAuditActor } from '../../request-context.mjs'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const randomId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`
const appError = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })
const ROLE_LABELS = {admin:'管理员',team_leader:'团队长',leader:'领导',member:'成员'}
const PASSWORD_ALGORITHM = 'pbkdf2-sha256'
const PASSWORD_ITERATIONS = 210000

export class SqliteUserRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteUserRepository requires relational storage')
    this.database = storage.database
  }

  view(row) {
    const user = {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
    return {id:user.id,username:user.username,displayName:user.displayName,role:user.role,roleLabel:ROLE_LABELS[user.role] || user.role,status:user.status,teamId:user.teamId,departmentId:user.departmentId,employeeId:user.employeeId,permissions:user.permissions || [],mustChangePassword:Boolean(user.mustChangePassword),createdAt:user.createdAt,updatedAt:user.updatedAt}
  }

  rowById(userId) { return this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId) }
  rowByUsername(username) { return this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE lower(username)=lower(?)').get(username) }
  hasUsers() { return Boolean(this.database.prepare('SELECT 1 FROM users LIMIT 1').get()) }
  findUser(userId) { const row = this.rowById(userId); return row ? {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''} : null }

  list() {
    const users = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users ORDER BY list_order').all().map((row) => this.view(row))
    const teams = this.database.prepare('SELECT payload_json FROM teams ORDER BY list_order').all().map((row) => parseJson(row.payload_json))
    const departments = this.database.prepare('SELECT payload_json FROM departments ORDER BY list_order').all().map((row) => parseJson(row.payload_json))
    const employees = this.database.prepare('SELECT payload_json FROM employees ORDER BY list_order').all().map((row) => parseJson(row.payload_json))
    return {items:users,options:{roles:Object.entries(ROLE_LABELS).map(([value,label]) => ({value,label})),teams,departments,employees}}
  }

  resolveScope(role, input) {
    if (role === 'admin') return {teamId:'',departmentId:'',employeeId:''}
    if (role === 'team_leader') {
      const team = this.database.prepare('SELECT id,department_id FROM teams WHERE id=? AND status != \'inactive\'').get(input.teamId)
      if (!team) throw appError('团队长账号必须绑定有效团队')
      return {teamId:team.id,departmentId:team.department_id,employeeId:''}
    }
    if (role === 'leader') {
      const department = this.database.prepare("SELECT id FROM departments WHERE id=? AND status != 'inactive'").get(input.departmentId)
      if (!department) throw appError('领导账号必须绑定有效部门')
      return {teamId:'',departmentId:department.id,employeeId:''}
    }
    if (role === 'member') {
      const employee = this.database.prepare("SELECT id,team_id,department_id FROM employees WHERE id=? AND status='active'").get(input.employeeId)
      if (!employee) throw appError('成员账号必须绑定有效成员')
      return {teamId:employee.team_id,departmentId:employee.department_id,employeeId:employee.id}
    }
    throw appError('角色无效')
  }

  hashPassword(password, salt) { return pbkdf2Sync(String(password),String(salt),PASSWORD_ITERATIONS,32,'sha256').toString('hex') }
  legacyHash(password, salt) { return createHash('sha256').update(`${salt}:${password}:employee-review`).digest('hex') }
  verifyPassword(password, user) {
    if (!user?.passwordHash || !user?.salt) return false
    return user.passwordAlgorithm === PASSWORD_ALGORITHM
      ? this.hashPassword(password,user.salt) === user.passwordHash
      : this.legacyHash(password,user.salt) === user.passwordHash
  }
  passwordFields(password, forceChange) {
    const salt = randomBytes(12).toString('hex')
    return {salt,passwordHash:this.hashPassword(password,salt),passwordAlgorithm:PASSWORD_ALGORITHM,passwordIterations:PASSWORD_ITERATIONS,mustChangePassword:Boolean(forceChange)}
  }

  login(username, password) {
    const row = this.rowByUsername(username)
    if (!row || row.status !== 'active') return null
    const user = {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
    if (!this.verifyPassword(password,user)) return null
    if (user.passwordAlgorithm !== PASSWORD_ALGORITHM) {
      const fields = this.passwordFields(password,Boolean(user.mustChangePassword))
      const updated = {...user,...fields,updatedAt:new Date().toISOString()}
      this.database.exec('BEGIN IMMEDIATE')
      try { this.updateRow(updated); this.database.exec('COMMIT') } catch (cause) { try { this.database.exec('ROLLBACK') } catch {}; throw cause }
      return updated
    }
    return user
  }

  updateRow(user) {
    const payload = {...user}
    delete payload.id; delete payload.username; delete payload.role; delete payload.status; delete payload.departmentId; delete payload.teamId; delete payload.employeeId
    this.database.prepare('UPDATE users SET username=?,role=?,status=?,department_id=?,team_id=?,employee_id=?,payload_json=? WHERE id=?').run(user.username,user.role,user.status,user.departmentId || null,user.teamId || null,user.employeeId || null,json({...payload,id:user.id,username:user.username,role:user.role,status:user.status,departmentId:user.departmentId,teamId:user.teamId,employeeId:user.employeeId}),user.id)
  }

  create(input) {
    const username = String(input.username || '').trim()
    const password = String(input.password || '')
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw appError('账号需为 3-32 位字母、数字或 ._-')
    if (this.rowByUsername(username)) throw appError('账号已存在',409)
    if (!ROLE_LABELS[input.role]) throw appError('角色无效')
    if (password.length < 8) throw appError('初始密码至少 8 位')
    const scope = this.resolveScope(input.role,input)
    const createdAt = new Date().toISOString()
    const user = {id:randomId('user'),username,displayName:String(input.displayName || '').trim() || username,role:input.role,...scope,status:input.status === 'inactive' ? 'inactive' : 'active',createdAt,updatedAt:createdAt,...this.passwordFields(password,input.mustChangePassword !== false)}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM users').get().value)
      this.updateInsert(user,order)
      appendAuditRecord(this.database,'user.create',{targetUserId:user.id,role:user.role},currentAuditActor(),createdAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(createdAt)
      this.database.exec('COMMIT'); return this.view(this.rowById(user.id))
    } catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  updateInsert(user, order) {
    this.database.prepare('INSERT INTO users (id,username,role,status,department_id,team_id,employee_id,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?)').run(user.id,user.username,user.role,user.status,user.departmentId || null,user.teamId || null,user.employeeId || null,json(user),order)
  }

  update(userId, input) {
    const row = this.rowById(userId)
    if (!row) throw appError('账号不存在',404,'NOT_FOUND')
    const previous = {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
    const username = String(input.username || previous.username).trim()
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw appError('账号需为 3-32 位字母、数字或 ._-')
    const duplicate = this.rowByUsername(username)
    if (duplicate && duplicate.id !== userId) throw appError('账号已存在',409)
    const role = input.role || previous.role
    if (!ROLE_LABELS[role]) throw appError('角色无效')
    const scope = this.resolveScope(role,input)
    const next = {...previous,username,displayName:String(input.displayName || '').trim() || previous.displayName,role,...scope,status:input.status === 'inactive' ? 'inactive' : 'active',updatedAt:new Date().toISOString()}
    if (String(input.password || '').length) {
      if (String(input.password).length < 8) throw appError('新密码至少 8 位')
      Object.assign(next,this.passwordFields(String(input.password),true))
    }
    const activeAdmins = this.database.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active' AND id != ?").get(userId).value + (next.role === 'admin' && next.status === 'active' ? 1 : 0)
    if (Number(activeAdmins) < 1) throw appError('系统必须保留至少一个启用管理员',409)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.updateRow(next)
      appendAuditRecord(this.database,'user.update',{targetUserId:userId},currentAuditActor(),next.updatedAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(next.updatedAt)
      this.database.exec('COMMIT')
      return this.view(this.rowById(userId))
    }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  changePassword(userId, currentPassword, newPassword) {
    const row = this.rowById(userId)
    if (!row || row.status !== 'active') throw appError('后台登录已失效',401)
    const user = {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
    if (!this.verifyPassword(currentPassword,user)) throw appError('当前密码错误',403)
    if (String(newPassword).length < 8) throw appError('新密码至少 8 位')
    if (String(newPassword) === String(currentPassword)) throw appError('新密码不能与当前密码相同')
    const next = {...user,...this.passwordFields(newPassword,false),updatedAt:new Date().toISOString()}
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.updateRow(next)
      appendAuditRecord(this.database,'password.change',{userId},currentAuditActor(),next.updatedAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(next.updatedAt)
      this.database.exec('COMMIT')
      return {changed:true}
    }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }

  delete(userId, currentUserId, options = {}) {
    const row = this.rowById(userId)
    if (!row) throw appError('账号不存在',404,'NOT_FOUND')
    if (userId === currentUserId) throw appError('不能删除当前登录账号',409)
    if (Number(this.database.prepare('SELECT COUNT(*) AS value FROM users').get().value) <= 1) throw appError('至少保留一个后台账号',409)
    if (row.role === 'admin' && row.status === 'active' && Number(this.database.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active' AND id != ?").get(userId).value) < 1) throw appError('不能删除最后一个启用管理员',409)
    const updatedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM users WHERE id=?').run(userId)
      if (options.audit !== false) appendAuditRecord(this.database,'user.delete',{targetUserId:userId},currentAuditActor(),updatedAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updatedAt)
      this.database.exec('COMMIT')
      return {deleted:true}
    }
    catch (cause) { try { this.database.exec('ROLLBACK') } catch {} ; throw cause }
  }
}
