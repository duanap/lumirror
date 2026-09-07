import { appendAuditRecord, createAuditRecord } from './audit-repository.mjs'

const DATABASE_KEY = 'employee_review_db_v1'
const parseJson = (value) => value === null || value === undefined || value === '' ? {} : JSON.parse(value)

export class SqliteMaintenanceRepository {
  constructor(storage) {
    if (!storage?.database || typeof storage.get !== 'function' || typeof storage.put !== 'function') throw new Error('SqliteMaintenanceRepository requires relational storage')
    this.storage = storage
    this.database = storage.database
  }

  findUser(userId) {
    const row = this.database.prepare('SELECT id,username,role,status,department_id,team_id,employee_id,payload_json FROM users WHERE id=?').get(userId)
    if (!row) return null
    return {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''}
  }

  async readSnapshot() {
    return this.storage.get(DATABASE_KEY,{type:'json'})
  }

  async readFullSnapshot(actor) {
    const createdAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const verifyCodeCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM verification_codes').get().value || 0)
      const scoreCount = Number(this.database.prepare('SELECT COUNT(*) AS value FROM scores').get().value || 0)
      appendAuditRecord(this.database,'export.full',{verifyCodeCount,scoreCount},actor,createdAt)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(createdAt)
      this.database.exec('COMMIT')
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
    return this.readSnapshot()
  }

  async importSnapshot(database, actor) {
    const snapshot = structuredClone(database)
    snapshot.logs = Array.isArray(snapshot.logs) ? snapshot.logs : []
    snapshot.logs.push(createAuditRecord('import.json',{
      employees:Array.isArray(snapshot.employees) ? snapshot.employees.length : 0,
      evaluationCodes:Array.isArray(snapshot.evaluationCodes) ? snapshot.evaluationCodes.length : 0
    },actor))
    await this.storage.put(DATABASE_KEY,snapshot)
    return {imported:true}
  }

  cleanup(actor) {
    const now = new Date()
    const nowText = now.toISOString()
    const retention = this.database.prepare('SELECT log_retention_days FROM settings WHERE singleton=1').get()
    const retentionDays = Math.max(7,Number(retention?.log_retention_days || 90))
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE timed_invites
        SET status='expired', payload_json=json_set(payload_json,'$.status','expired')
        WHERE status NOT IN ('completed','expired') AND expires_at IS NOT NULL AND expires_at <= ?
      `).run(nowText)
      const expiredTimedInvites = Number(this.database.prepare("SELECT COUNT(*) AS value FROM timed_invites WHERE status='expired'").get().value || 0)
      const removedLogs = Number(this.database.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff).changes || 0)
      const removedTasks = Number(this.database.prepare(`
        DELETE FROM evaluation_tasks
        WHERE status != 'submitted' AND NOT EXISTS (
          SELECT 1 FROM evaluation_activities e WHERE e.id=evaluation_tasks.evaluation_id
        )
      `).run().changes || 0)
      const result = {expiredTimedInvites,removedLogs,removedTasks}
      appendAuditRecord(this.database,'maintenance.cleanup',result,actor,nowText)
      this.database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(nowText)
      this.database.exec('COMMIT')
      return result
    } catch (cause) {
      try { this.database.exec('ROLLBACK') } catch {}
      throw cause
    }
  }
}
