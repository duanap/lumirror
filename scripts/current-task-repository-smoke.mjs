import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import onRequest from '../edge-functions/api/[[default]].js'
import { SqliteTaskRepository } from '../server/repositories/sqlite/task-repository.mjs'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(), 'lumirror-current-task-'))
const databaseFile = path.join(dataDir, 'lumirror.sqlite')
const secret = 'current-task-test-secret'
const now = new Date()
const startTime = new Date(now.getTime() - 60_000).toISOString()
const endTime = new Date(now.getTime() + 3_600_000).toISOString()

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function token(payload) {
  const encoded = encode(payload)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))
  return `${encoded}.${Buffer.from(signature).toString('base64url')}`
}

const storage = new RelationalSqliteStorage(databaseFile)
await storage.put('employee_review_db_v1', {
  version:4, createdAt:now.toISOString(), updatedAt:now.toISOString(),
  users:[],
  departments:[{id:'dep_1',name:'研发部',status:'active',sort:1}],
  teams:[{id:'team_1',name:'研发团队',departmentId:'dep_1',status:'active',sort:1}],
  employees:[{id:'emp_1',name:'测试成员',gender:'unknown',departmentId:'dep_1',teamId:'team_1',position:'工程师',status:'active',tagIds:[]}],
  memberTags:[],
  periods:[{id:'period_1',name:'测试周期',startTime,endTime,status:'active'}],
  evaluationCodes:[{
    id:'eval_1',code:'PJ0001',linkCode:'00000001',name:'当前任务测试',periodId:'period_1',teamId:'team_1',departmentId:'dep_1',
    status:'active',startTime,endTime,targetType:'employee',targetEmployeeIds:['emp_1'],targetTeamIds:[],
    participantEmployeeIds:['emp_1'],excludeSelf:false,rounding:'one_decimal',rules:[{id:'ability',name:'能力',min:60,max:99,weight:100,operation:'add',enabled:true}]
  }],
  verifyCodes:[{id:'verify_1',evaluationCodeId:'eval_1',codeHash:'hash',codeFingerprint:'fingerprint',participantEmployeeId:'emp_1',status:'in_progress',expected:1,submitted:0,remaining:1,firstUsedAt:now.toISOString()}],
  tasks:[{id:'task_1',evaluationCodeId:'eval_1',verifyCodeId:'verify_1',evaluatorHash:'evaluator',targetType:'employee',targetId:'emp_1',targetEmployeeId:'emp_1',status:'pending',submittedAt:null}],
  scores:[],timedInvites:[],logs:[],settings:{systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
})

const taskRepository = new SqliteTaskRepository(storage)
let snapshotRead = false
storage.get = async () => {
  snapshotRead = true
  throw new Error('current-task must not read the whole snapshot')
}

try {
  const response = await onRequest({
    request:new Request('http://localhost/api/public/current-task', {
      headers:{authorization:`Bearer ${await token({role:'evaluator',evaluationCodeId:'eval_1',verifyCodeId:'verify_1',evaluatorHash:'evaluator',exp:Math.floor(Date.now() / 1000) + 3600})}`}
    }),
    params:{},
    env:{APP_ENV:'production',ADMIN_TOKEN_SECRET:secret,PUBLIC_TOKEN_SECRET:secret,EVALUATION_KV:storage,TASK_REPOSITORY:taskRepository,STORAGE_MODEL:'sqlite-relational'}
  })
  const payload = await response.json()
  assert.equal(response.status,200)
  assert.equal(payload.data.id,'task_1')
  assert.equal(payload.data.target.id,'emp_1')
  assert.equal(payload.data.targetType,'employee')
  assert.equal(payload.data.rules[0].id,'ability')
  assert.equal(payload.data.remaining,1)
  assert.equal(snapshotRead,false)
  assert.equal(storage.snapshotReadCount,0)
  console.log('Current-task repository smoke passed: direct SQL query without whole snapshot read')
} finally {
  storage.close()
  await rm(dataDir,{recursive:true,force:true})
}
