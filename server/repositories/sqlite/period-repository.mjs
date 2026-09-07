import { randomBytes } from 'node:crypto'

const json = (value) => JSON.stringify(value ?? null)
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)
const id = () => `period_${randomBytes(8).toString('hex')}`
const error = (message, status = 400, code = 'BAD_REQUEST') => Object.assign(new Error(message), { status, code })

export class SqlitePeriodRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqlitePeriodRepository requires relational storage')
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id, username, role, status, department_id, team_id, employee_id, payload_json FROM users WHERE id = ?').get(userId)
    if (!row) return null
    return {
      ...parseJson(row.payload_json), id:row.id, username:row.username, role:row.role, status:row.status,
      departmentId:row.department_id || '', teamId:row.team_id || '', employeeId:row.employee_id || ''
    }
  }

  list() {
    return this.database.prepare('SELECT payload_json FROM review_periods ORDER BY list_order').all().map((row) => parseJson(row.payload_json))
  }

  create(input) {
    const now = new Date().toISOString()
    const period = {
      ...input, id:id(), status:input.status || 'active', anonymous:true, allowRepeat:false, allowModify:false,
      createdAt:now, updatedAt:now
    }
    if (!period.name || !period.startTime || !period.endTime) throw error('周期名称和时间不能为空')
    if (new Date(period.startTime).getTime() >= new Date(period.endTime).getTime()) throw error('结束时间必须晚于开始时间')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const listOrder = Number(this.database.prepare('SELECT COALESCE(MAX(list_order) + 1, 0) AS value FROM review_periods').get().value)
      this.database.prepare('INSERT INTO review_periods (id, name, status, start_time, end_time, payload_json, list_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(period.id,period.name,period.status,period.startTime,period.endTime,json(period),listOrder)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(now)
      this.database.exec('COMMIT')
      return period
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  update(periodId, input) {
    const row = this.database.prepare('SELECT payload_json FROM review_periods WHERE id = ?').get(periodId)
    if (!row) throw error('周期不存在',404,'NOT_FOUND')
    const previous = parseJson(row.payload_json)
    const next = {...previous,...input,id:periodId,updatedAt:new Date().toISOString()}
    if (!next.name || !next.startTime || !next.endTime) throw error('周期名称和时间不能为空')
    if (new Date(next.startTime).getTime() >= new Date(next.endTime).getTime()) throw error('结束时间必须晚于开始时间')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE review_periods SET name = ?, status = ?, start_time = ?, end_time = ?, payload_json = ? WHERE id = ?')
        .run(next.name,next.status || 'active',next.startTime,next.endTime,json(next),periodId)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(next.updatedAt)
      this.database.exec('COMMIT')
      return next
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }

  delete(periodId) {
    const row = this.database.prepare('SELECT 1 FROM review_periods WHERE id = ?').get(periodId)
    if (!row) throw error('周期不存在',404,'NOT_FOUND')
    if (this.database.prepare('SELECT 1 FROM evaluation_activities WHERE period_id = ? LIMIT 1').get(periodId)) throw error('该周期已被评价活动使用，不能删除',409,'PERIOD_IN_USE')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM review_periods WHERE id = ?').run(periodId)
      this.database.prepare('UPDATE app_state SET updated_at = ? WHERE singleton = 1').run(new Date().toISOString())
      this.database.exec('COMMIT')
      return { deleted:true }
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }
}
