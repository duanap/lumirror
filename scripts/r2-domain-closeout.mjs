import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'
import { SqliteAuditRepository } from '../server/repositories/sqlite/audit-repository.mjs'
import { SqliteBatchRepository } from '../server/repositories/sqlite/batch-repository.mjs'
import { SqliteEmployeeRepository } from '../server/repositories/sqlite/employee-repository.mjs'
import { SqliteEvaluationRepository } from '../server/repositories/sqlite/evaluation-repository.mjs'
import { SqliteMaintenanceRepository } from '../server/repositories/sqlite/maintenance-repository.mjs'
import { SqliteOrganizationRepository } from '../server/repositories/sqlite/organization-repository.mjs'
import { SqlitePeriodRepository } from '../server/repositories/sqlite/period-repository.mjs'
import { SqliteSettingsRepository } from '../server/repositories/sqlite/settings-repository.mjs'
import { SqliteTaskRepository } from '../server/repositories/sqlite/task-repository.mjs'
import { SqliteUserRepository } from '../server/repositories/sqlite/user-repository.mjs'
import { runWithAuditActor } from '../server/request-context.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(),'lumirror-r2-closeout-'))
const databaseFile = path.join(dataDir,'closeout.sqlite')
const storage = new RelationalSqliteStorage(databaseFile)

const actor = {
  userId:'user_admin',
  username:'admin',
  role:'admin',
  teamId:'',
  departmentId:'',
  employeeId:''
}

const leaderActor = {
  userId:'user_leader',
  username:'leader',
  role:'leader',
  teamId:'',
  departmentId:'dep_001',
  employeeId:''
}

const initial = {
  version:4,
  createdAt:'2026-09-07T00:00:00.000Z',
  updatedAt:'2026-09-07T00:00:00.000Z',
  users:[{
    id:'user_admin',username:'admin',displayName:'管理员',role:'admin',status:'active',
    departmentId:'',teamId:'',employeeId:'',permissions:[],mustChangePassword:false,
    passwordAlgorithm:'pbkdf2-sha256',passwordIterations:210000,passwordHash:'seed',salt:'seed',
    createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'
  }],
  departments:[{id:'dep_001',name:'研发部',status:'active',createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'}],
  teams:[{id:'team_001',departmentId:'dep_001',name:'平台组',status:'active',sort:1,createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'}],
  employees:[
    {id:'emp_001',departmentId:'dep_001',teamId:'team_001',name:'参与者',gender:'unknown',position:'工程师',status:'active',avatar:'',tagIds:[],createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'},
    {id:'emp_002',departmentId:'dep_001',teamId:'team_001',name:'目标成员',gender:'unknown',position:'工程师',status:'active',avatar:'',tagIds:[],createdAt:'2026-09-07T00:00:00.000Z',updatedAt:'2026-09-07T00:00:00.000Z'}
  ],
  memberTags:[],periods:[],evaluationCodes:[],verifyCodes:[],tasks:[],scores:[],timedInvites:[],logs:[],
  settings:{systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
}

await storage.put('employee_review_db_v1',initial)

const auditRepository = new SqliteAuditRepository(storage)
const employeeRepository = new SqliteEmployeeRepository(storage)
const evaluationRepository = new SqliteEvaluationRepository(storage)
const organizationRepository = new SqliteOrganizationRepository(storage)
const periodRepository = new SqlitePeriodRepository(storage)
const settingsRepository = new SqliteSettingsRepository(storage)
const taskRepository = new SqliteTaskRepository(storage)
const userRepository = new SqliteUserRepository(storage)
const batchRepository = new SqliteBatchRepository({
  storage,employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository
})
const maintenanceRepository = new SqliteMaintenanceRepository(storage)

const expectedActions = new Set([
  'user.create','user.update','password.change','user.delete',
  'employee.create','member_tag.create','member_tag.rename','member_tag.delete',
  'settings.update','evaluation.create','evaluation.archive','evaluation.unarchive',
  'batch.operation','maintenance.cleanup','export.full','import.json'
])

function isForbiddenAuditDetailKey(key) {
  const normalized = String(key || '').replace(/[_-]/g,'').toLowerCase()
  if (/(password|authorization|cookie|session|token)/.test(normalized)) return true
  return new Set([
    'invitecode','invitelink','timedinvitelink','rawinvite','rawcode','fullcode',
    'scores','scorevalues','scorecontent','values',
    'evaluator','evaluatorid','evaluatorhash','evaluatoridentity'
  ]).has(normalized)
}

function assertSafeDetail(value, action, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item,index) => assertSafeDetail(item,action,[...pathParts,String(index)]))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key,item] of Object.entries(value)) {
    assert.ok(!isForbiddenAuditDetailKey(key),`${action} audit detail contains forbidden key: ${[...pathParts,key].join('.')}`)
    assertSafeDetail(item,action,[...pathParts,key])
  }
}

function assertForbidden(operation, label) {
  assert.throws(operation,(error) => error?.status === 403 && error?.code === 'FORBIDDEN',label)
}

try {
  assertForbidden(() => employeeRepository.create({
    name:'越权新增',gender:'unknown',departmentId:'dep_001',teamId:'team_001',position:'测试',status:'active',avatar:'',tagIds:[]
  },leaderActor),'leader must not create employees')
  assertForbidden(() => employeeRepository.update('emp_002',{status:'inactive'},leaderActor),'leader must not update employees')
  assertForbidden(() => employeeRepository.delete('emp_002',leaderActor),'leader must not delete employees')

  await runWithAuditActor(actor,async () => {
    const user = userRepository.create({
      username:'closeout_user',displayName:'Closeout User',password:'closeout-user-password',
      role:'team_leader',teamId:'team_001',departmentId:'dep_001',status:'active',mustChangePassword:false
    })
    userRepository.update(user.id,{displayName:'Closeout User Updated',role:'team_leader',teamId:'team_001',departmentId:'dep_001',status:'active'})
    userRepository.changePassword(user.id,'closeout-user-password','closeout-user-password-2')
    userRepository.delete(user.id,actor.userId)

    const inactiveUser = userRepository.create({
      username:'inactive_user',displayName:'Inactive User',password:'inactive-user-password',
      role:'team_leader',teamId:'team_001',departmentId:'dep_001',status:'inactive',mustChangePassword:false
    })
    assert.throws(
      () => userRepository.changePassword(inactiveUser.id,'inactive-user-password','inactive-user-password-2'),
      (error) => error?.status === 401,
      'inactive account must not change password with a stale session'
    )
    userRepository.delete(inactiveUser.id,actor.userId)

    const tag = employeeRepository.createTag({name:'Closeout 标签'},actor)
    employeeRepository.updateTag(tag.id,{name:'Closeout 标签更新'},actor)
    employeeRepository.create({
      name:'Closeout 成员',gender:'unknown',departmentId:'dep_001',teamId:'team_001',
      position:'测试',status:'active',avatar:'',tagIds:[]
    },actor)
    employeeRepository.deleteTag(tag.id,actor)

    settingsRepository.update({systemName:'和光镜鉴 Closeout',publicSessionMinutes:90,logRetentionDays:120})

    const now = Date.now()
    const created = evaluationRepository.createActivity({
      name:'Closeout 评价',teamId:'team_001',participantMode:'selected',participantEmployeeIds:['emp_001'],
      targetType:'employee',targetMode:'selected',targetEmployeeIds:['emp_002'],excludeSelf:true,
      startTime:new Date(now - 120_000).toISOString(),endTime:new Date(now + 3_600_000).toISOString()
    },actor)
    const evaluationId = created.activity.id
    evaluationRepository.update(evaluationId,{endTime:new Date(now - 1_000).toISOString()},actor)
    evaluationRepository.update(evaluationId,{status:'archived'},actor)
    evaluationRepository.update(evaluationId,{status:'active'},actor)

    const batch = batchRepository.run(actor,{resource:'employees',action:'status',status:'inactive',ids:['emp_002']})
    assert.equal(batch.successCount,1)
    assert.equal(batch.failureCount,0)

    const cleanup = maintenanceRepository.cleanup(actor)
    assert.ok(Number.isInteger(cleanup.expiredTimedInvites))
    const full = await maintenanceRepository.exportFull(actor)
    assert.equal(full.version,4)
    const imported = await maintenanceRepository.importData(full,actor)
    assert.deepEqual(imported,{imported:true})
  })

  const rows = storage.database.prepare('SELECT action,actor_id,role,detail_json,payload_json FROM audit_logs ORDER BY list_order').all()
  const actions = new Set(rows.map((row) => row.action))
  for (const action of expectedActions) assert.ok(actions.has(action),`missing closeout audit action: ${action}`)

  for (const row of rows.filter((item) => expectedActions.has(item.action))) {
    assert.equal(row.actor_id,actor.userId,`${row.action} must record verified actor id`)
    assert.equal(row.role,actor.role,`${row.action} must record verified actor role`)
    assertSafeDetail(JSON.parse(row.detail_json || '{}'),row.action)
    const payload = JSON.parse(row.payload_json || '{}')
    assert.equal(payload.actorId,actor.userId,`${row.action} payload actor mismatch`)
    assert.ok(!Object.hasOwn(payload,'password'),`${row.action} payload must not contain password`)
    assert.ok(!Object.hasOwn(payload,'token'),`${row.action} payload must not contain token`)
  }

  assert.equal(storage.database.prepare('SELECT schema_version FROM app_state WHERE singleton=1').get().schema_version,4)
  assert.equal(storage.database.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.equal(storage.database.prepare('PRAGMA quick_check').get().quick_check,'ok')

  const auditList = auditRepository.list(actor,{limit:200})
  assert.ok(auditList.items.length >= expectedActions.size)
  console.log('R2 domain closeout gate passed: audit coverage, RBAC, maintenance boundary, schema 4 and integrity checks')
} finally {
  storage.close()
  await rm(dataDir,{recursive:true,force:true})
}
