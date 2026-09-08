import { appendAuditRecord } from './audit-repository.mjs'
import { json, parseJson, randomId, transaction, touch, AppError } from './common.mjs'
const AVATAR_GENDERS = new Map([
  ['avatar_male_young_plain','male'],['avatar_male_young_glasses','male'],['avatar_male_adult_plain','male'],['avatar_male_adult_glasses','male'],
  ['avatar_female_young_plain','female'],['avatar_female_young_glasses','female'],['avatar_female_adult_plain','female'],['avatar_female_adult_glasses','female']
])
const normalize = (value) => String(value || '').trim()

export class SqliteEmployeeRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteEmployeeRepository requires relational storage')
    this.database = storage.database
  }
  findUser(id) {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(id)
    return row ? {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''} : null
  }
  visibleTeamIds(session) {
    if (session.role === 'admin') return new Set(this.database.prepare('SELECT id FROM teams').all().map((row) => row.id))
    if (session.role === 'team_leader') return new Set(session.teamId ? [session.teamId] : [])
    if (session.role === 'leader') return new Set(this.database.prepare('SELECT id FROM teams WHERE department_id=?').all(session.departmentId).map((row) => row.id))
    return new Set()
  }
  requireWrite(session) {
    if (!['admin','team_leader'].includes(session.role)) throw new AppError('当前账号没有此操作权限',403,'FORBIDDEN')
  }
  tagsForMany(ids) {
    const result = new Map(ids.map((id) => [id,{tagIds:[],tags:[]}]))
    if (!ids.length) return result
    const rows = this.database.prepare(`SELECT et.employee_id,mt.id,mt.name,mt.payload_json FROM employee_tags et JOIN member_tags mt ON mt.id=et.tag_id WHERE et.employee_id IN (${ids.map(() => '?').join(',')}) ORDER BY et.employee_id,et.list_order`).all(...ids)
    for (const row of rows) {
      const value = result.get(row.employee_id)
      value.tagIds.push(row.id)
      value.tags.push({...parseJson(row.payload_json),id:row.id,name:row.name})
    }
    return result
  }
  tagsFor(id) { return this.tagsForMany([id]).get(id) }
  view(row, tags = this.tagsFor(row.id)) {
    return {...parseJson(row.payload_json),id:row.id,departmentId:row.department_id,teamId:row.team_id,name:row.name,status:row.status,departmentName:row.department_name || '',teamName:row.team_name || '',...tags}
  }
  list(session, filters = {}) {
    const teamIds = [...this.visibleTeamIds(session)]
    const placeholders = teamIds.map(() => '?').join(',') || "''"
    const clauses = [`e.team_id IN (${placeholders})`]
    const params = [...teamIds]
    for (const [key,column] of [['teamId','team_id'],['departmentId','department_id'],['status','status']]) {
      if (filters[key]) { clauses.push(`e.${column}=?`); params.push(String(filters[key])) }
    }
    const q = normalize(filters.q).toLowerCase()
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g,'\\$&')}%`
      clauses.push("(lower(e.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(json_extract(e.payload_json,'$.position'),'')) LIKE ? ESCAPE '\\' OR lower(t.name) LIKE ? ESCAPE '\\' OR lower(d.name) LIKE ? ESCAPE '\\')")
      params.push(pattern,pattern,pattern,pattern)
    }
    const from = `FROM employees e JOIN departments d ON d.id=e.department_id JOIN teams t ON t.id=e.team_id WHERE ${clauses.join(' AND ')}`
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS value ${from}`).get(...params).value)
    const paged = filters.limit !== undefined && filters.limit !== null && filters.limit !== ''
    const limit = paged ? Math.min(200,Math.max(1,Math.trunc(Number(filters.limit) || 50))) : null
    const offset = Math.max(0,Math.trunc(Number(filters.offset) || 0))
    const rows = this.database.prepare(`SELECT e.*,d.name AS department_name,t.name AS team_name ${from} ORDER BY e.list_order,e.id${paged ? ' LIMIT ? OFFSET ?' : ''}`).all(...params,...(paged ? [limit,offset] : []))
    const tags = this.tagsForMany(rows.map((row) => row.id))
    const items = rows.map((row) => this.view(row,tags.get(row.id)))
    const teams = this.database.prepare(`SELECT t.id,t.name,t.department_id,t.status,d.name AS department_name FROM teams t JOIN departments d ON d.id=t.department_id WHERE t.id IN (${placeholders}) ORDER BY t.list_order`).all(...teamIds)
      .map((row) => ({id:row.id,name:row.name,departmentId:row.department_id,status:row.status,departmentName:row.department_name}))
    const departmentIds = [...new Set(teams.map((team) => team.departmentId))]
    const departments = departmentIds.length ? this.database.prepare(`SELECT * FROM departments WHERE id IN (${departmentIds.map(() => '?').join(',')}) ORDER BY list_order`).all(...departmentIds).map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,status:row.status})) : []
    return {items,total,limit,offset,options:{departments,teams,tags:this.listTags(session)},canWrite:['admin','team_leader'].includes(session.role),canManageTags:session.role === 'admin'}
  }
  normalizeAvatar(value, gender) { const avatar = normalize(value); return AVATAR_GENDERS.get(avatar) === gender ? avatar : '' }
  validTagIds(values) {
    if (values !== undefined && !Array.isArray(values)) throw new AppError('成员标签格式无效')
    const ids = [...new Set((values || []).map(String).filter(Boolean))]
    if (ids.length > 100) throw new AppError('单个成员最多关联 100 个标签')
    if (!ids.length) return []
    const valid = new Set(this.database.prepare(`SELECT id FROM member_tags WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((row) => row.id))
    return ids.filter((id) => valid.has(id))
  }
  fields(input, previous, session) {
    const teamId = input.teamId || previous?.teamId
    const team = this.database.prepare("SELECT id,department_id FROM teams WHERE id=? AND status != 'inactive'").get(teamId)
    if (!team || !this.visibleTeamIds(session).has(team.id)) throw new AppError('所属团队无效')
    if (input.departmentId && input.departmentId !== team.department_id) throw new AppError('所属部门与团队不一致')
    const name = normalize(input.name ?? previous?.name)
    const position = String(input.position ?? previous?.position ?? '')
    if (!name || name.length > 80) throw new AppError('成员姓名需为 1-80 个字符')
    if (position.length > 120) throw new AppError('职位名称不能超过 120 个字符')
    if (input.status !== undefined && !['active','inactive'].includes(input.status)) throw new AppError('成员状态无效')
    const gender = ['male','female','unknown'].includes(input.gender) ? input.gender : previous?.gender || 'unknown'
    return {name,position,gender,departmentId:team.department_id,teamId:team.id,status:input.status ?? previous?.status ?? 'active',avatar:this.normalizeAvatar(input.avatar ?? previous?.avatar,gender),tagIds:this.validTagIds(input.tagIds ?? previous?.tagIds)}
  }
  writeTags(employeeId, ids) {
    this.database.prepare('DELETE FROM employee_tags WHERE employee_id=?').run(employeeId)
    const insert = this.database.prepare('INSERT INTO employee_tags VALUES (?,?,?)')
    ids.forEach((id,index) => insert.run(employeeId,id,index))
  }
  create(input, session) {
    this.requireWrite(session)
    return transaction(this.database,() => {
      const now = new Date().toISOString()
      const employee = {id:randomId('emp'),...this.fields(input,null,session),createdAt:now,updatedAt:now}
      const {tagIds,...payload} = employee
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM employees').get().value)
      this.database.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,?)').run(employee.id,employee.departmentId,employee.teamId,employee.name,employee.status,json(payload),order)
      this.writeTags(employee.id,tagIds)
      appendAuditRecord(this.database,'employee.create',{employeeId:employee.id,teamId:employee.teamId},session,now)
      touch(this.database,now)
      return employee
    })
  }
  update(employeeId, input, session) {
    this.requireWrite(session)
    return transaction(this.database,() => {
      const row = this.database.prepare('SELECT * FROM employees WHERE id=?').get(employeeId)
      if (!row || !this.visibleTeamIds(session).has(row.team_id)) throw new AppError('成员不存在或无权编辑',404,'NOT_FOUND')
      const previous = this.view(row)
      const next = {...previous,...this.fields(input,previous,session),updatedAt:new Date().toISOString()}
      const {tagIds,tags,employeeNo,phone,departmentName,teamName,...payload} = next
      this.database.prepare('UPDATE employees SET department_id=?,team_id=?,name=?,status=?,payload_json=? WHERE id=?').run(next.departmentId,next.teamId,next.name,next.status,json(payload),employeeId)
      this.writeTags(employeeId,tagIds)
      if (next.teamId !== previous.teamId || next.departmentId !== previous.departmentId) {
        this.database.prepare("UPDATE users SET team_id=?,department_id=?,payload_json=json_set(payload_json,'$.teamId',?,'$.departmentId',?,'$.authVersion',COALESCE(json_extract(payload_json,'$.authVersion'),0)+1) WHERE employee_id=?")
          .run(next.teamId,next.departmentId,next.teamId,next.departmentId,employeeId)
      }
      appendAuditRecord(this.database,'employee.update',{employeeId},session,next.updatedAt)
      touch(this.database,next.updatedAt)
      return {...payload,tagIds}
    })
  }
  delete(employeeId, session) {
    this.requireWrite(session)
    return transaction(this.database,() => {
      const row = this.database.prepare('SELECT id,team_id FROM employees WHERE id=?').get(employeeId)
      if (!row || !this.visibleTeamIds(session).has(row.team_id)) throw new AppError('成员不存在或无权删除',404,'NOT_FOUND')
      const related = this.database.prepare(`SELECT 1 FROM verification_codes WHERE participant_employee_id=?
        UNION ALL SELECT 1 FROM evaluation_participants WHERE employee_id=?
        UNION ALL SELECT 1 FROM evaluation_targets WHERE target_type='employee' AND target_id=?
        UNION ALL SELECT 1 FROM evaluation_tasks WHERE target_type='employee' AND target_id=?
        UNION ALL SELECT 1 FROM scores WHERE target_type='employee' AND target_id=?
        UNION ALL SELECT 1 FROM users WHERE employee_id=? LIMIT 1`).get(...Array(6).fill(employeeId))
      if (related) throw new AppError('该成员已关联评价、邀请码或账号，请改为停用',409,'EMPLOYEE_IN_USE')
      this.database.prepare('DELETE FROM employees WHERE id=?').run(employeeId)
      const now = new Date().toISOString()
      appendAuditRecord(this.database,'employee.delete',{employeeId},session,now)
      touch(this.database,now)
      return {deleted:true}
    })
  }
  listTags(session) {
    const ids = [...this.visibleTeamIds(session)]
    const placeholders = ids.map(() => '?').join(',') || "''"
    return this.database.prepare(`SELECT mt.id,mt.name,mt.payload_json,COUNT(e.id) AS member_count FROM member_tags mt LEFT JOIN employee_tags et ON et.tag_id=mt.id LEFT JOIN employees e ON e.id=et.employee_id AND e.team_id IN (${placeholders}) GROUP BY mt.id ORDER BY mt.list_order`).all(...ids)
      .map((row) => ({...parseJson(row.payload_json),id:row.id,name:row.name,memberCount:Number(row.member_count || 0)}))
  }
  tagName(input, exceptId = '') {
    const name = normalize(input.name).replace(/\s+/g,' ')
    if (!name || name.length > 20) throw new AppError('标签名称需为 1-20 个字符')
    if (this.database.prepare('SELECT 1 FROM member_tags WHERE lower(name)=lower(?) AND id != ?').get(name,exceptId)) throw new AppError('标签名称已存在',409,'TAG_EXISTS')
    return name
  }
  createTag(input, session) {
    this.requireWrite(session)
    return transaction(this.database,() => {
      const name = this.tagName(input)
      const now = new Date().toISOString()
      const tag = {id:randomId('tag'),name,createdAt:now,updatedAt:now}
      const order = Number(this.database.prepare('SELECT COALESCE(MAX(list_order)+1,0) AS value FROM member_tags').get().value)
      this.database.prepare('INSERT INTO member_tags VALUES (?,?,?,?)').run(tag.id,name,json(tag),order)
      appendAuditRecord(this.database,'member_tag.create',{tagId:tag.id,name},session,now)
      touch(this.database,now)
      return {...tag,memberCount:0}
    })
  }
  updateTag(tagId, input, session) {
    if (session.role !== 'admin') throw new AppError('只有管理员可以重命名成员标签',403,'FORBIDDEN')
    return transaction(this.database,() => {
      const row = this.database.prepare('SELECT * FROM member_tags WHERE id=?').get(tagId)
      if (!row) throw new AppError('成员标签不存在',404,'NOT_FOUND')
      const name = this.tagName(input,tagId)
      const next = {...parseJson(row.payload_json),id:tagId,name,updatedAt:new Date().toISOString()}
      this.database.prepare('UPDATE member_tags SET name=?,payload_json=? WHERE id=?').run(name,json(next),tagId)
      appendAuditRecord(this.database,'member_tag.rename',{tagId,previousName:row.name,name},session,next.updatedAt)
      touch(this.database,next.updatedAt)
      return next
    })
  }
  deleteTag(tagId, session) {
    if (session.role !== 'admin') throw new AppError('只有管理员可以删除成员标签',403,'FORBIDDEN')
    return transaction(this.database,() => {
      const row = this.database.prepare('SELECT id,name FROM member_tags WHERE id=?').get(tagId)
      if (!row) throw new AppError('成员标签不存在',404,'NOT_FOUND')
      const detachedCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM employee_tags WHERE tag_id=?').get(tagId).value)
      this.database.prepare('DELETE FROM member_tags WHERE id=?').run(tagId)
      const now = new Date().toISOString()
      appendAuditRecord(this.database,'member_tag.delete',{tagId,name:row.name,detachedCount},session,now)
      touch(this.database,now)
      return {deleted:true,detachedCount}
    })
  }
}
