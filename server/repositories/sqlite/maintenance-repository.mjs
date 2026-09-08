import { createHash, randomUUID } from 'node:crypto'
import { appendAuditRecord, createAuditRecord } from './audit-repository.mjs'
import { AppError, parseJson, transaction, touch } from './common.mjs'
import { buildStatisticalExport } from '../../domain/statistical-export.mjs'
import { prepareImportSnapshot } from '../../domain/import-snapshot.mjs'

const DATABASE_KEY = 'employee_review_db_v1'
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class SqliteMaintenanceRepository {
  constructor(storage) {
    if (!storage?.database) throw new Error('SqliteMaintenanceRepository requires relational storage')
    this.storage = storage
    this.database = storage.database
    this.instanceId = randomUUID()
  }
  findUser(id) {
    const row = this.database.prepare('SELECT * FROM users WHERE id=?').get(id)
    return row ? {...parseJson(row.payload_json),id:row.id,username:row.username,role:row.role,status:row.status,departmentId:row.department_id || '',teamId:row.team_id || '',employeeId:row.employee_id || ''} : null
  }
  currentUsers() {
    return this.database.prepare('SELECT id FROM users ORDER BY list_order').all().map((row) => this.findUser(row.id))
  }
  revision() {
    const changes = Number(this.database.prepare('SELECT total_changes() AS value').get().value || 0)
    const external = Number(this.database.prepare('PRAGMA data_version').get().data_version || 0)
    return `${this.instanceId}:${changes}:${external}`
  }
  async readSnapshot() { return this.storage.get(DATABASE_KEY,{type:'json'}) }
  async exportSanitized() {
    const snapshot = await this.readSnapshot()
    return buildStatisticalExport(snapshot)
  }
  async exportFull(actor) {
    transaction(this.database,() => {
      const now = new Date().toISOString()
      appendAuditRecord(this.database,'export.full',{
        verifyCodeCount:Number(this.database.prepare('SELECT COUNT(*) AS value FROM verification_codes').get().value || 0),
        scoreCount:Number(this.database.prepare('SELECT COUNT(*) AS value FROM scores').get().value || 0)
      },actor,now)
      touch(this.database,now)
    })
    return this.readSnapshot()
  }
  preflight(input) {
    const snapshot = prepareImportSnapshot(input,this.currentUsers())
    return {
      valid:true,previewHash:digest(input),revision:this.revision(),
      counts:Object.fromEntries(['departments','teams','employees','periods','evaluationCodes','verifyCodes','tasks','scores'].map((key) => [key,snapshot[key].length])),
      retainedAccounts:snapshot.users.length,requiresConfirmation:'IMPORT_REPLACE_DATA'
    }
  }
  async importData(input, actor, expected = {}) {
    if (expected.revision && expected.revision !== this.revision()) throw new AppError('预检后数据已变化，请重新预检',409,'IMPORT_PREVIEW_STALE')
    if (expected.previewHash && expected.previewHash !== digest(input)) throw new AppError('导入文件与预检不一致',409,'IMPORT_PREVIEW_STALE')
    const snapshot = prepareImportSnapshot(input,this.currentUsers())
    const now = new Date().toISOString()
    const extra = this.database.prepare('SELECT extra_json FROM app_state WHERE singleton=1').get()
    snapshot.publicAuthVersion = Number(parseJson(extra?.extra_json).publicAuthVersion || 0)+1
    snapshot.importedAt = now
    snapshot.updatedAt = now
    snapshot.users = snapshot.users.map((user) => ({...user,authVersion:Number(user.authVersion || 0)+1,updatedAt:now}))
    snapshot.logs.push(createAuditRecord('import.json',{employees:snapshot.employees.length,evaluationCodes:snapshot.evaluationCodes.length},actor,now))
    // RelationalSqliteStorage.put owns one BEGIN IMMEDIATE transaction and replaces the snapshot atomically.
    // Its implementation is synchronous internally even though it returns a Promise, so no same-process
    // request can interleave between this revision check and the replacement write.
    await this.storage.put(DATABASE_KEY,snapshot)
    return {imported:true}
  }
  cleanup(actor) {
    return transaction(this.database,() => {
      const now = new Date().toISOString()
      const retention = this.database.prepare('SELECT log_retention_days FROM settings WHERE singleton=1').get()
      const cutoff = new Date(Date.now()-Math.max(7,Number(retention?.log_retention_days || 90))*86400000).toISOString()
      this.database.prepare("UPDATE timed_invites SET status='expired',payload_json=json_set(payload_json,'$.status','expired') WHERE status NOT IN ('completed','expired') AND expires_at IS NOT NULL AND expires_at <= ?").run(now)
      const result = {
        expiredTimedInvites:Number(this.database.prepare("SELECT COUNT(*) AS value FROM timed_invites WHERE status='expired'").get().value || 0),
        removedLogs:Number(this.database.prepare('DELETE FROM audit_logs WHERE created_at < ?').run(cutoff).changes || 0),
        removedTasks:Number(this.database.prepare("DELETE FROM evaluation_tasks WHERE status != 'submitted' AND NOT EXISTS (SELECT 1 FROM evaluation_activities e WHERE e.id=evaluation_tasks.evaluation_id)").run().changes || 0)
      }
      appendAuditRecord(this.database,'maintenance.cleanup',result,actor,now)
      touch(this.database,now)
      return result
    })
  }
}
