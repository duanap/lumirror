import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'

const dataDir = await mkdtemp(path.join(tmpdir(),'lumirror-repository-concurrency-'))
const databaseFile = path.join(dataDir,'lumirror.sqlite')
const now = new Date().toISOString()
const storage = new RelationalSqliteStorage(databaseFile)
await storage.put('employee_review_db_v1', {
  version:4,createdAt:now,updatedAt:now,
  users:[],departments:[{id:'dep_1',name:'研发部',status:'active'}],teams:[{id:'team_1',name:'研发团队',departmentId:'dep_1',status:'active'}],
  employees:[{id:'emp_1',name:'目标成员',gender:'unknown',departmentId:'dep_1',teamId:'team_1',position:'工程师',status:'active',tagIds:[]}],memberTags:[],
  periods:[{id:'period_1',name:'测试周期',startTime:'2026-01-01T00:00:00.000Z',endTime:'2030-01-01T00:00:00.000Z',status:'active'}],
  evaluationCodes:[{id:'eval_1',code:'PJ0001',linkCode:'00000001',name:'并发测试',periodId:'period_1',teamId:'team_1',departmentId:'dep_1',status:'active',startTime:'2026-01-01T00:00:00.000Z',endTime:'2030-01-01T00:00:00.000Z',rules:[{id:'ability',name:'能力',min:60,max:99,weight:100,operation:'add',enabled:true}],rounding:'one_decimal',participantMode:'selected',participantEmployeeIds:['emp_1'],targetType:'employee',targetMode:'selected',targetEmployeeIds:['emp_1'],targetTeamIds:[],excludeSelf:false}],
  verifyCodes:[{id:'verify_1',evaluationCodeId:'eval_1',codeHash:'hash',codeFingerprint:'fingerprint',codeMask:'****01',suffix:'01',evaluatorHash:'evaluator',participantEmployeeId:'emp_1',expected:1,submitted:0,remaining:1,status:'in_progress',firstUsedAt:now,lastUsedAt:now,completedAt:null}],
  tasks:[{id:'task_1',evaluationCodeId:'eval_1',verifyCodeId:'verify_1',evaluatorHash:'evaluator',targetType:'employee',targetId:'emp_1',targetEmployeeId:'emp_1',status:'pending',submittedAt:null}],
  scores:[],timedInvites:[],logs:[],settings:{systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
})
storage.close()

const input = JSON.stringify({
  evaluationId:'eval_1',verifyId:'verify_1',taskId:'task_1',
  score:{id:'score_race',evaluationCodeId:'eval_1',taskId:'task_1',targetType:'employee',targetId:'emp_1',anonymousToken:'anonymous',values:{ability:90},total:90,createdAt:now},
  task:{id:'task_1',evaluationCodeId:'eval_1',verifyCodeId:'verify_1',targetType:'employee',targetId:'emp_1',status:'submitted',submittedAt:now},
  verify:{id:'verify_1',evaluationCodeId:'eval_1',evaluatorHash:'evaluator',status:'in_progress',firstUsedAt:now,completedAt:null}
})

function runWorker() {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./r2-repository-worker.mjs',import.meta.url),{workerData:{databaseFile,input}})
    worker.once('message',resolve)
    worker.once('error',reject)
  })
}

try {
  const results = await Promise.all([runWorker(),runWorker()])
  assert.equal(results.filter((result) => result.ok).length,1)
  assert.equal(results.filter((result) => result.code === 'TASK_ALREADY_SUBMITTED').length,1)
  const database = new DatabaseSync(databaseFile)
  assert.equal(database.prepare('SELECT COUNT(*) AS value FROM scores').get().value,1)
  assert.equal(database.prepare("SELECT status FROM evaluation_tasks WHERE id='task_1'").get().status,'submitted')
  assert.equal(database.prepare("SELECT COUNT(*) AS value FROM audit_logs WHERE action='score.submit'").get().value,1)
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check,'ok')
  database.close()
  const settingsStorage = new RelationalSqliteStorage(databaseFile)
  assert.equal(settingsStorage.database.prepare('PRAGMA busy_timeout').get().timeout,5000)
  settingsStorage.close()
  console.log('R2 repository concurrency gate passed: two SQLite connections, one task submission and consistent rollback')
} finally {
  await rm(dataDir,{recursive:true,force:true})
}
