import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pbkdf2Sync } from 'node:crypto'
import { RelationalSqliteStorage } from '../../server/repositories/sqlite/storage.mjs'
import { bootstrapDatabase } from '../../server/app/bootstrap.mjs'
import { SqliteUserRepository } from '../../server/repositories/sqlite/user-repository.mjs'
import { SqliteEmployeeRepository } from '../../server/repositories/sqlite/employee-repository.mjs'
import { SqliteSettingsRepository } from '../../server/repositories/sqlite/settings-repository.mjs'
import { SqliteEvaluationRepository } from '../../server/repositories/sqlite/evaluation-repository.mjs'
import { SqliteMaintenanceRepository } from '../../server/repositories/sqlite/maintenance-repository.mjs'
import { runWithAuditActor } from '../../server/request-context.mjs'

const actor = {userId:'user_admin',username:'admin',role:'admin',teamId:'',departmentId:'',employeeId:'',authVersion:0}
const forbidden = /(password|authorization|cookie|session|token|evaluator|scorevalues|scorecontent)/i

function assertSafe(value,path = '') {
  if (!value || typeof value !== 'object') return
  for (const [key,item] of Object.entries(value)) {
    assert.equal(forbidden.test(key.replace(/[_-]/g,'')),false,`forbidden audit field: ${path}${key}`)
    assertSafe(item,`${path}${key}.`)
  }
}

test('async authentication keeps historical PBKDF2 compatibility and audit boundaries',async () => {
  const storage = new RelationalSqliteStorage(':memory:')
  try {
    await bootstrapDatabase(storage,{INITIAL_ADMIN_PASSWORD:'closeout-initial-password',BOOTSTRAP_DEMO_DATA:'true'})
    const database = storage.database
    const users = new SqliteUserRepository(storage)
    const employees = new SqliteEmployeeRepository(storage)
    const settings = new SqliteSettingsRepository(storage)
    const evaluations = new SqliteEvaluationRepository(storage)
    const maintenance = new SqliteMaintenanceRepository(storage)

    const historicalPassword = 'historical-pbkdf2-password'
    const salt = 'historical-pbkdf2-salt'
    const iterations = 120000
    const passwordHash = pbkdf2Sync(historicalPassword,salt,iterations,32,'sha256').toString('hex')
    const historical = {id:'user_historical',username:'historical',displayName:'历史账号',role:'admin',status:'active',departmentId:'',teamId:'',employeeId:'',mustChangePassword:false,passwordAlgorithm:'pbkdf2-sha256',passwordIterations:iterations,passwordHash,salt,authVersion:0,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}
    database.prepare('INSERT INTO users (id,username,role,status,department_id,team_id,employee_id,payload_json,list_order) VALUES (?,?,?,?,NULL,NULL,NULL,?,?)').run(historical.id,historical.username,historical.role,historical.status,JSON.stringify(historical),1)
    const historicalLogin = await users.login('historical',historicalPassword)
    assert.equal(historicalLogin?.id,historical.id)
    assert.equal(historicalLogin?.passwordIterations,iterations)

    const leader = {userId:'leader',role:'leader',departmentId:'dep_rd',teamId:'',employeeId:''}
    assert.throws(() => employees.create({name:'越权新增',teamId:'team_rd',departmentId:'dep_rd'},leader),(error) => error.status === 403)

    await runWithAuditActor(actor,async () => {
      const created = await users.create({username:'async_closeout',displayName:'Async Closeout',password:'async-closeout-password',role:'team_leader',teamId:'team_rd',status:'active',mustChangePassword:false})
      await users.update(created.id,{displayName:'Async Closeout Updated',role:'team_leader',teamId:'team_rd',status:'active'})
      await users.changePassword(created.id,'async-closeout-password','async-closeout-password-2')
      users.delete(created.id,actor.userId)

      const employee = employees.create({name:'Closeout 成员',gender:'unknown',departmentId:'dep_rd',teamId:'team_rd',position:'测试',status:'active',tagIds:[]},actor)
      employees.delete(employee.id,actor)
      settings.update({systemName:'和光镜鉴 Closeout',publicSessionMinutes:90,logRetentionDays:120})

      const now = Date.now()
      const evaluation = evaluations.createActivity({name:'Closeout 评价',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',targetMode:'selected',targetEmployeeIds:['emp_002'],excludeSelf:true,startTime:new Date(now-120000).toISOString(),endTime:new Date(now+3600000).toISOString()},actor)
      assert.ok(evaluation.activity.id)
      maintenance.cleanup(actor)
      await maintenance.exportFull(actor)
    })

    const rows = database.prepare('SELECT action,actor_id,role,detail_json FROM audit_logs ORDER BY list_order').all()
    for (const action of ['user.create','user.update','password.change','user.delete','employee.create','employee.delete','settings.update','evaluation.create','maintenance.cleanup','export.full']) {
      assert.ok(rows.some((row) => row.action === action),`missing audit action ${action}`)
    }
    for (const row of rows.filter((item) => item.actor_id === actor.userId)) {
      assert.equal(row.role,'admin')
      assertSafe(JSON.parse(row.detail_json || '{}'))
    }
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check,'ok')
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0)
  } finally { storage.close() }
})
