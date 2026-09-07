import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'
import { SqliteEvaluationRepository } from '../server/repositories/sqlite/evaluation-repository.mjs'
import { SqliteTaskRepository } from '../server/repositories/sqlite/task-repository.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(),'lumirror-r2-participant-'))
const storage = new RelationalSqliteStorage(path.join(dataDir,'participant.sqlite'))
const nowText = '2026-09-07T00:00:00.000Z'

const session = {userId:'team_leader_test',username:'team_leader_test',role:'team_leader',teamId:'team_a',departmentId:'dep_a',employeeId:''}
const admin = {userId:'admin_test',username:'admin_test',role:'admin',teamId:'',departmentId:'',employeeId:''}

const employee = (id,name,departmentId,teamId) => ({id,name,gender:'unknown',departmentId,teamId,position:'测试',status:'active',avatar:'',tagIds:[],createdAt:nowText,updatedAt:nowText})

await storage.put('employee_review_db_v1',{
  version:4,createdAt:nowText,updatedAt:nowText,users:[],
  departments:[{id:'dep_a',name:'A 部门',status:'active'},{id:'dep_b',name:'B 部门',status:'active'}],
  teams:[{id:'team_a',departmentId:'dep_a',name:'A 团队',status:'active'},{id:'team_b',departmentId:'dep_b',name:'B 团队',status:'active'}],
  employees:[employee('emp_a_1','A 参与者','dep_a','team_a'),employee('emp_a_2','A 目标','dep_a','team_a'),employee('emp_a_3','A 新参与者','dep_a','team_a'),employee('emp_b_1','B 成员','dep_b','team_b')],
  memberTags:[],periods:[],evaluationCodes:[],verifyCodes:[],tasks:[],scores:[],timedInvites:[],logs:[],
  settings:{systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
})

const evaluationRepository = new SqliteEvaluationRepository(storage)
const taskRepository = new SqliteTaskRepository(storage)

try {
  const now = Date.now()
  const created = evaluationRepository.createActivity({
    name:'参与者关系合同',teamId:'team_a',participantMode:'selected',participantEmployeeIds:['emp_a_1'],
    targetType:'employee',targetMode:'selected',targetEmployeeIds:['emp_a_2'],excludeSelf:true,
    startTime:new Date(now - 60_000).toISOString(),endTime:new Date(now + 3_600_000).toISOString()
  },admin)
  const evaluationId = created.activity.id

  const generated = taskRepository.generateVerifyCodes(evaluationId,session,{participantEmployeeIds:['emp_a_3']})
  assert.equal(generated.codes.length,1)
  assert.equal(generated.codes[0].employeeId,'emp_a_3')

  const participantIds = storage.database.prepare('SELECT employee_id FROM evaluation_participants WHERE evaluation_id=? ORDER BY list_order').all(evaluationId).map((row) => row.employee_id)
  assert.deepEqual(participantIds,['emp_a_1','emp_a_3'])

  const view = evaluationRepository.list(session).items.find((item) => item.id === evaluationId)
  assert.deepEqual(view.participantEmployeeIds,['emp_a_1','emp_a_3'])

  assert.throws(
    () => taskRepository.generateVerifyCodes(evaluationId,session,{participantEmployeeIds:['emp_b_1']}),
    (error) => error?.status === 400,
    'team leader must not bind another team member to an invite'
  )

  assert.equal(storage.database.prepare('SELECT schema_version FROM app_state WHERE singleton=1').get().schema_version,4)
  assert.equal(storage.database.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.equal(storage.database.prepare('PRAGMA quick_check').get().quick_check,'ok')
  console.log('R2 participant invite contract passed: team scope and evaluation_participants stay consistent')
} finally {
  storage.close()
  await rm(dataDir,{recursive:true,force:true})
}
