import { appendAuditRecord } from './audit-repository.mjs'
import { currentAuditActor } from '../../request-context.mjs'
import { json, parseJson, randomId, transaction, touch, AppError } from './common.mjs'
import { PASSWORD_ALGORITHM, passwordFields, verifyPassword, credentialIdentity, validatePassword } from '../../security/passwords.mjs'
import { ROLE_LABELS, userView } from '../../security/permissions.mjs'

const rowView = (row) => row ? {
  ...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,
  departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''
} : null
const normalize = (value) => String(value || '').trim()
const versionOf = (user) => Number.isSafeInteger(Number(user.authVersion)) && Number(user.authVersion) >= 0 ? Number(user.authVersion) : 0

export class SqliteUserRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteUserRepository requires relational storage')
    this.database = storage.database
  }
  rowById(id) { return this.database.prepare('SELECT * FROM users WHERE id=?').get(id) }
  rowByUsername(username) { return this.database.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(username) }
  findUser(id) { return rowView(this.rowById(id)) }
  hasUsers() { return Boolean(this.database.prepare('SELECT 1 FROM users LIMIT 1').get()) }
  view(row) { return userView(rowView(row)) }
  list() {
    const items = this.database.prepare('SELECT * FROM users ORDER BY list_order').all().map((row) => this.view(row))
    const read = (table) => this.database.prepare(`SELECT payload_json FROM ${table} ORDER BY list_order`).all().map((row) => parseJson(row.payload_json))
    return {items,options:{roles:Object.entries(ROLE_LABELS).map(([value,label]) => ({value,label})),teams:read('teams'),departments:read('departments'),employees:read('employees')}}
  }
  resolveScope(role, input) {
    if (role === 'admin') return {teamId:'',departmentId:'',employeeId:''}
    if (role === 'team_leader') {
      const team = this.database.prepare("SELECT id,department_id FROM teams WHERE id=? AND status != 'inactive'").get(input.teamId)
      if (!team) throw new AppError('团队长账号必须绑定有效团队')
      return {teamId:team.id,departmentId:team.department_id,employeeId:''}
    }
    if (role === 'leader') {
      const department = this.database.prepare("SELECT id FROM departments WHERE id=? AND status != 'inactive'").get(input.departmentId)
      if (!department) throw new AppError('领导账号必须绑定有效部门')
      return {teamId:'',departmentId:department.id,employeeId:''}
    }
    if (role === 'member') {
      const employee = this.database.prepare("SELECT id,team_id,department_id FROM employees WHERE id=? AND status='active'").get(input.employeeId)
      if (!employee) throw new AppError('成员账号必须绑定有效成员')
      return {teamId:employee.team_id,departmentId:employee.department_id,employeeId:employee.id}
    }
    throw new AppError('角色无效')
  }
  validateUsername(username, exceptId = '') {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new AppError('账号需为 3-32 位字母、数字或 ._-')
    const duplicate = this.rowByUsername(username)
    if (duplicate && duplicate.id !== exceptId) throw new AppError('账号已存在',409,'USERNAME_EXISTS')
  }
  assertActiveAdminRemains(user) {
    const others = Number(this.database.prepare("SELECT COUNT(*) AS value FROM users WHERE role='admin' AND status='active' AND id != ?").get(user.id).value)
    if (others + (user.role === 'admin' && user.status === 'active' ? 1 : 0) < 1) throw new AppError('系统必须保留至少一个启用管理员',409,'LAST_ADMIN')
  }
  updateRow(user) {
    this.database.prepare('UPDATE users SET username=?,role=?,status=?,department_id=?,team_id=?,employee_id=?,payload_json=? WHERE id=?')
      .run(user.username,user.role,user.status,user.departmentId || null,user.teamId || null,user.employeeId || null,json(user),user.id)
  }
  updateInsert(user, order) {
    this.database.prepare('INSERT INTO users (id,username,role,status,department_id,team_id,employee_id,payload_json,list_order) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(user.id,user.username,user.role,user.status,user.departmentId || null,user.teamId || null,user.employeeId || null,json(user),order)
  }
  assertActorCurrent() {
    const actor = currentAuditActor()
    if (!actor?.userId || actor.authVersion === undefined) return
    const user = this.findUser(actor.userId)
    if (!user || user.status !== 'active' || versionOf(user) !== Number(actor.authVersion) || user.role !== actor.role) throw new AppError('账号权限已发生变化，请重新登录',401,'SESSION_EXPIRED')
  }
  audit(action, detail, at) { appendAuditRecord(this.database,action,detail,currentAuditActor() || {},at); touch(this.database,at) }

  async login(username, password) {
    const original = rowView(this.rowByUsername(normalize(username)))
    const valid = await verifyPassword(password,original?.status === 'active' ? original : null)
    if (!valid || !original) return null
    const upgraded = original.passwordAlgorithm !== PASSWORD_ALGORITHM ? await passwordFields(password,original.mustChangePassword) : null
    // Re-read AFTER all expensive asynchronous work, then verify credentials under the write lock.
    return transaction(this.database,() => {
      const current = this.findUser(original.id)
      if (!current || current.status !== 'active' || credentialIdentity(current) !== credentialIdentity(original)) return null
      if (!upgraded) return current
      const user = {...current,...upgraded,updatedAt:new Date().toISOString()}
      this.updateRow(user)
      touch(this.database,user.updatedAt)
      return user
    })
  }

  async create(input) {
    const username = normalize(input.username)
    this.validateUsername(username)
    if (!Object.hasOwn(ROLE_LABELS,input.role)) throw new AppError('角色无效')
    const fields = await passwordFields(input.password,input.mustChangePassword !== false)
    return transaction(this.database,() => {
      this.assertActorCurrent()
      this.validateUsername(username)
      const scope = this.resolveScope(input.role,input)
      const now = new Date().toISOString()
      const user = {id:randomId('user'),username,displayName:normalize(input.displayName) || username,role:input.role,...scope,status:input.status === 'inactive' ? 'inactive' : 'active',createdAt:now,updatedAt:now,authVersion:0,...fields}
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM users').get().value)
      this.updateInsert(user,order)
      this.audit('user.create',{targetUserId:user.id,role:user.role},now)
      return userView(user)
    })
  }

  async update(userId, input) {
    if (!this.findUser(userId)) throw new AppError('账号不存在',404,'NOT_FOUND')
    const fields = input.password !== undefined && input.password !== '' ? await passwordFields(input.password,true) : null
    return transaction(this.database,() => {
      this.assertActorCurrent()
      const previous = this.findUser(userId)
      if (!previous) throw new AppError('账号不存在',404,'NOT_FOUND')
      const username = normalize(input.username ?? previous.username)
      this.validateUsername(username,userId)
      const role = input.role ?? previous.role
      if (!Object.hasOwn(ROLE_LABELS,role)) throw new AppError('角色无效')
      if (input.status !== undefined && !['active','inactive'].includes(input.status)) throw new AppError('账号状态无效')
      const scope = this.resolveScope(role,{...previous,...input})
      const next = {...previous,username,displayName:normalize(input.displayName ?? previous.displayName) || username,role,...scope,status:input.status ?? previous.status,updatedAt:new Date().toISOString(),...(fields || {})}
      const securityChanged = Boolean(fields) || ['role','status','teamId','departmentId','employeeId'].some((key) => next[key] !== previous[key])
      next.authVersion = versionOf(previous)+(securityChanged ? 1 : 0)
      this.assertActiveAdminRemains(next)
      this.updateRow(next)
      this.audit('user.update',{targetUserId:userId},next.updatedAt)
      return userView(next)
    })
  }

  async changePassword(userId, currentPassword, newPassword) {
    const original = this.findUser(userId)
    if (!original || original.status !== 'active') throw new AppError('后台登录已失效',401,'SESSION_EXPIRED')
    validatePassword(newPassword,8)
    if (newPassword === currentPassword) throw new AppError('新密码不能与当前密码相同')
    if (!await verifyPassword(currentPassword,original)) throw new AppError('当前密码错误',403,'CURRENT_PASSWORD_INVALID')
    const fields = await passwordFields(newPassword,false)
    return transaction(this.database,() => {
      this.assertActorCurrent()
      const current = this.findUser(userId)
      if (!current || current.status !== 'active' || credentialIdentity(current) !== credentialIdentity(original) || versionOf(current) !== versionOf(original)) throw new AppError('账号已更新，请重新登录',401,'SESSION_EXPIRED')
      const next = {...current,...fields,authVersion:versionOf(current)+1,updatedAt:new Date().toISOString()}
      this.updateRow(next)
      this.audit('password.change',{userId},next.updatedAt)
      return {changed:true}
    })
  }

  setStatus(userId, status, actor) {
    if (actor.role !== 'admin') throw new AppError('当前账号没有此操作权限',403,'FORBIDDEN')
    if (!['active','inactive'].includes(status)) throw new AppError('账号状态无效')
    if (userId === actor.userId && status === 'inactive') throw new AppError('不能停用当前登录账号',409,'CURRENT_USER')
    return transaction(this.database,() => {
      this.assertActorCurrent()
      const previous = this.findUser(userId)
      if (!previous) throw new AppError('账号不存在',404,'NOT_FOUND')
      const next = {...previous,status,authVersion:versionOf(previous)+(status !== previous.status ? 1 : 0),updatedAt:new Date().toISOString()}
      this.assertActiveAdminRemains(next)
      this.updateRow(next)
      touch(this.database,next.updatedAt)
      return {updated:true}
    })
  }

  revokeSessions(userId) {
    return transaction(this.database,() => {
      const user = this.findUser(userId)
      if (!user || user.status !== 'active') throw new AppError('后台登录已失效',401,'SESSION_EXPIRED')
      const now = new Date().toISOString()
      this.updateRow({...user,authVersion:versionOf(user)+1,updatedAt:now})
      this.audit('session.revoke',{userId},now)
      return {loggedOut:true}
    })
  }

  delete(userId, currentUserId, options = {}) {
    return transaction(this.database,() => {
      const user = this.findUser(userId)
      if (!user) throw new AppError('账号不存在',404,'NOT_FOUND')
      if (userId === currentUserId) throw new AppError('不能删除当前登录账号',409,'CURRENT_USER')
      this.assertActiveAdminRemains({...user,status:'inactive'})
      this.database.prepare('DELETE FROM users WHERE id=?').run(userId)
      const now = new Date().toISOString()
      if (options.audit !== false) this.audit('user.delete',{targetUserId:userId},now)
      else touch(this.database,now)
      return {deleted:true}
    })
  }
}
