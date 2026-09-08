import assert from 'node:assert/strict'
import { test } from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RelationalSqliteStorage } from '../../server/repositories/sqlite/storage.mjs'
import { bootstrapDatabase } from '../../server/app/bootstrap.mjs'
import { SqliteUserRepository } from '../../server/repositories/sqlite/user-repository.mjs'
import { SqliteEmployeeRepository } from '../../server/repositories/sqlite/employee-repository.mjs'
import { SqliteScoreRepository } from '../../server/repositories/sqlite/score-repository.mjs'
import { SqlitePublicScoreRepository } from '../../server/repositories/sqlite/public-score-repository.mjs'
import { SqliteSettingsRepository } from '../../server/repositories/sqlite/settings-repository.mjs'
import { SqliteMaintenanceRepository } from '../../server/repositories/sqlite/maintenance-repository.mjs'
import { runWithAuditActor } from '../../server/request-context.mjs'
import { RateLimiter } from '../../server/security/rate-limit.mjs'
import { signToken, resolveAdminActor, publicSession } from '../../server/security/tokens.mjs'
import { createRequestHandler, trustedClientAddress } from '../../server/http/node-adapter.mjs'
import { calculateScore } from '../../shared/scoring.mjs'

const initialPassword = 'Synthetic-initial-password'
const changedPassword = 'Synthetic-changed-password'
const actor = {userId:'user_admin',username:'admin',role:'admin',authVersion:0}
const values = {ability:90,attitude:91,collaboration:92}

async function fixture(databaseFile = ':memory:') {
  const storage = new RelationalSqliteStorage(databaseFile)
  await bootstrapDatabase(storage,{INITIAL_ADMIN_PASSWORD:initialPassword,BOOTSTRAP_DEMO_DATA:'true'})
  const users = new SqliteUserRepository(storage)
  const scores = new SqliteScoreRepository(storage)
  const env = {
    APP_ENV:'production',APP_VERSION:'1.5.1',ADMIN_TOKEN_SECRET:'synthetic-admin-token-secret',PUBLIC_TOKEN_SECRET:'synthetic-public-token-secret',SESSION_COOKIE_SECURE:'false',
    EVALUATION_KV:storage,USER_REPOSITORY:users,EMPLOYEE_REPOSITORY:new SqliteEmployeeRepository(storage),SCORE_REPOSITORY:scores,
    PUBLIC_SCORE_REPOSITORY:new SqlitePublicScoreRepository(storage,scores),SETTINGS_REPOSITORY:new SqliteSettingsRepository(storage),
    MAINTENANCE_REPOSITORY:new SqliteMaintenanceRepository(storage),RATE_LIMITER:new RateLimiter()
  }
  return {storage,users,env}
}
function evaluatorSession(storage, verifyId = 'verify_demo') {
  const row = storage.database.prepare('SELECT evaluation_id,payload_json FROM verification_codes WHERE id=?').get(verifyId)
  const verify = JSON.parse(row.payload_json)
  return {role:'evaluator',publicVersion:0,evaluationCodeId:row.evaluation_id,verifyCodeId:verifyId,evaluatorHash:verify.evaluatorHash}
}
function rules(storage) { return storage.database.prepare('SELECT payload_json FROM evaluation_rules ORDER BY list_order').all().map((row) => JSON.parse(row.payload_json)) }
async function listen(handler) {
  const server = http.createServer((req,res) => { void handler(req,res) })
  server.listen(0,'127.0.0.1')
  await once(server,'listening')
  return {server,url:`http://127.0.0.1:${server.address().port}/api`,close:() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })}
}

test('shared scoring rejects malformed input and preserves supported formulas',() => {
  const equal = [{id:'a',enabled:true,min:0,max:99,weight:100,operation:'add'},{id:'b',enabled:true,min:0,max:99,weight:100,operation:'add'}]
  assert.equal(calculateScore({a:80,b:91},equal,'one_decimal'),85.5)
  assert.equal(calculateScore({a:80,b:91},equal,'floor'),85)
  assert.equal(calculateScore({a:'80',b:91},equal),null)
  assert.equal(calculateScore({a:80,b:91},[{...equal[0],weight:50},equal[1]]),null)
  assert.equal(calculateScore({a:80,b:91},equal,'unknown'),null)
  assert.equal(calculateScore(Object.create({a:80,b:91}),equal),null)
  assert.equal(calculateScore({a:0,b:0,c:99},[...equal,{id:'c',enabled:true,min:0,max:99,weight:100,operation:'subtract'}]),-99)
})

test('bootstrap is idempotent and password changes invalidate old admin sessions',async () => {
  const {storage,users,env} = await fixture()
  try {
    const oldToken = signToken({kind:'backend',userId:'user_admin',authVersion:0},env.ADMIN_TOKEN_SECRET,3600)
    const request = new Request('http://localhost/api/admin/me',{headers:{authorization:`Bearer ${oldToken}`}})
    assert.ok(resolveAdminActor(request,env))
    assert.equal(await bootstrapDatabase(storage,{INITIAL_ADMIN_PASSWORD:'different'}),false)
    assert.equal((await users.login('ADMIN',initialPassword)).id,'user_admin')
    assert.equal(await users.login('admin','wrong-password'),null)
    await users.changePassword('user_admin',initialPassword,changedPassword)
    assert.equal(resolveAdminActor(request,env),null)
    assert.equal((await users.login('admin',changedPassword)).authVersion,1)
    assert.equal(await users.login('admin',initialPassword),null)
    const pending = runWithAuditActor({...actor,authVersion:1},() => users.changePassword('user_admin',changedPassword,'should-not-be-applied'))
    users.revokeSessions('user_admin')
    await assert.rejects(pending,(error) => error.code === 'SESSION_EXPIRED')
    assert.ok(await users.login('admin',changedPassword))
    assert.equal(storage.database.prepare('PRAGMA quick_check').get().quick_check,'ok')
  } finally { storage.close() }
})

test('referenced employees cannot be deleted while unreferenced records can be removed',async () => {
  const {storage,env} = await fixture()
  try {
    const before = Number(storage.database.prepare('SELECT COUNT(*) AS value FROM employees').get().value)
    assert.throws(() => env.EMPLOYEE_REPOSITORY.delete('emp_001',actor),(error) => error.status === 409 && error.code === 'EMPLOYEE_IN_USE')
    assert.equal(Number(storage.database.prepare('SELECT COUNT(*) AS value FROM employees').get().value),before)
    const temporary = env.EMPLOYEE_REPOSITORY.create({name:'Temporary',teamId:'team_rd',departmentId:'dep_rd'},actor)
    assert.deepEqual(env.EMPLOYEE_REPOSITORY.delete(temporary.id,actor),{deleted:true})
    const page = env.EMPLOYEE_REPOSITORY.list(actor,{limit:2,offset:1})
    assert.equal(page.items.length,2)
    assert.equal(page.total,5)
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(),[])
  } finally { storage.close() }
})

test('first score freezes score rules, duplicate submit conflicts and inactive historical target remains visible',async () => {
  const {storage,env} = await fixture()
  try {
    const task = storage.database.prepare('SELECT * FROM evaluation_tasks ORDER BY list_order LIMIT 1').get()
    const session = evaluatorSession(storage)
    assert.equal(env.PUBLIC_SCORE_REPOSITORY.submit(session,{taskId:task.id,scores:values}).total,91)
    assert.throws(() => env.PUBLIC_SCORE_REPOSITORY.submit(session,{taskId:task.id,scores:values}),(error) => error.code === 'TASK_ALREADY_SUBMITTED')
    assert.throws(() => env.SETTINGS_REPOSITORY.updateScoreRules('eval_demo',{rules:rules(storage),rounding:'round'},actor),(error) => error.code === 'SCORE_RULES_LOCKED')
    const before = env.SCORE_REPOSITORY.listResults(actor,'eval_demo').items.find((item) => item.id === task.target_id)
    env.EMPLOYEE_REPOSITORY.update(task.target_id,{status:'inactive',name:'Changed after submission'},actor)
    const after = env.SCORE_REPOSITORY.listResults(actor,'eval_demo').items.find((item) => item.id === task.target_id)
    assert.equal(after.total,before.total)
    assert.equal(after.name,before.name)
    assert.equal(after.status,'inactive')
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(),[])
  } finally { storage.close() }
})

test('statistical export has no evaluator linkage and restore preflight is non-mutating',async () => {
  const {storage,users,env} = await fixture()
  try {
    const baseTask = storage.database.prepare('SELECT * FROM evaluation_tasks ORDER BY list_order LIMIT 1').get()
    const now = new Date().toISOString()
    for (let i=0;i<3;i++) {
      const verifyId = `verify_test_${i}`, taskId = `task_test_${i}`
      const verify = {id:verifyId,evaluationCodeId:'eval_demo',evaluatorHash:`hash-${i}`,codeHash:'a'.repeat(63)+i,codeFingerprint:'b'.repeat(63)+i,participantEmployeeId:`emp_00${i+3}`,status:'unused',createdAt:now}
      storage.database.prepare('INSERT INTO verification_codes VALUES (?,?,?,?,?,?,?,?)').run(verifyId,'eval_demo',verify.participantEmployeeId,verify.codeHash,verify.codeFingerprint,'unused',JSON.stringify(verify),10+i)
      const task = {id:taskId,evaluationCodeId:'eval_demo',verifyCodeId:verifyId,targetType:'employee',targetId:baseTask.target_id,status:'pending'}
      storage.database.prepare('INSERT INTO evaluation_tasks VALUES (?,?,?,?,?,?,?,?)').run(taskId,'eval_demo',verifyId,'employee',baseTask.target_id,'pending',JSON.stringify(task),10+i)
      env.PUBLIC_SCORE_REPOSITORY.submit(evaluatorSession(storage,verifyId),{taskId,scores:values})
    }
    assert.equal((await env.MAINTENANCE_REPOSITORY.exportSanitized()).items.length,0)
    const ended = new Date(Date.now()-1000).toISOString()
    storage.database.prepare("UPDATE evaluation_activities SET end_time=?,payload_json=json_set(payload_json,'$.endTime',?) WHERE id='eval_demo'").run(ended,ended)
    const statistical = await env.MAINTENANCE_REPOSITORY.exportSanitized()
    assert.equal(statistical.restorable,false)
    assert.equal(statistical.items.length,1)
    assert.equal(statistical.items[0].reviewCount,3)
    const serialized = JSON.stringify(statistical)
    for (const forbidden of ['taskId','verifyCodeId','participantEmployeeId','anonymousToken','evaluatorHash','audit_','verify_test_','task_test_','score_','passwordHash','codeFingerprint']) assert.equal(serialized.includes(forbidden),false,forbidden)
    assert.throws(() => env.MAINTENANCE_REPOSITORY.preflight(statistical),(error) => error.code === 'NOT_A_BACKUP')
    const full = await env.MAINTENANCE_REPOSITORY.exportFull(actor)
    const originalHash = users.findUser('user_admin').passwordHash
    const oldToken = signToken(evaluatorSession(storage),env.PUBLIC_TOKEN_SECRET,3600)
    const oldRequest = new Request('http://localhost/api/public/remaining',{headers:{authorization:`Bearer ${oldToken}`}})
    assert.ok(publicSession(oldRequest,env))
    const revision = env.MAINTENANCE_REPOSITORY.revision()
    const preview = env.MAINTENANCE_REPOSITORY.preflight(full)
    assert.equal(env.MAINTENANCE_REPOSITORY.revision(),revision)
    const bad = structuredClone(full)
    bad.scores[0].taskId = 'missing-task'
    assert.throws(() => env.MAINTENANCE_REPOSITORY.preflight(bad),(error) => error.code === 'IMPORT_INVALID')
    assert.equal(env.MAINTENANCE_REPOSITORY.revision(),revision)
    assert.deepEqual(await env.MAINTENANCE_REPOSITORY.importData(full,actor,preview),{imported:true})
    assert.equal(users.findUser('user_admin').passwordHash,originalHash)
    assert.equal(publicSession(oldRequest,env),null)
    await assert.rejects(env.MAINTENANCE_REPOSITORY.importData(full,actor,preview),(error) => error.code === 'IMPORT_PREVIEW_STALE')
    assert.deepEqual(storage.database.prepare('PRAGMA foreign_key_check').all(),[])
  } finally { storage.close() }
})

test('future database schema is rejected before the file can be modified',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'lumirror-future-schema-'))
  const filename = path.join(directory,'future.sqlite')
  try {
    const future = new DatabaseSync(filename)
    future.exec('CREATE TABLE keep_me (id INTEGER); INSERT INTO keep_me VALUES (1); PRAGMA user_version=99;')
    future.close()
    const before = await readFile(filename)
    assert.throws(() => new RelationalSqliteStorage(filename),/newer application/)
    assert.deepEqual(await readFile(filename),before)
  } finally { await rm(directory,{recursive:true,force:true}) }
})

test('rate limiting is bounded and forwarded client IP is trusted only from local proxy',() => {
  let now = 0
  const limiter = new RateLimiter({capacity:2,now:() => now})
  limiter.take('a',1,100)
  assert.throws(() => limiter.take('a',1,100),(error) => error.status === 429 && error.retryAfter === 1)
  limiter.take('b',2,100)
  assert.throws(() => limiter.take('c',2,100),(error) => error.status === 429)
  now = 101
  limiter.take('c',2,100)
  assert.equal(limiter.buckets.size,1)
  assert.equal(trustedClientAddress({socket:{remoteAddress:'203.0.113.2'},headers:{'x-real-ip':'127.0.0.1'}},{}),'203.0.113.2')
  assert.equal(trustedClientAddress({socket:{remoteAddress:'127.0.0.1'},headers:{'x-real-ip':'203.0.113.2'}},{}),'203.0.113.2')
})

test('HTTP adapter enforces refreshed cookies, CSRF, CORS, JSON limits and request-id logging',async () => {
  const {storage,env} = await fixture()
  const logs = []
  const app = await listen(createRequestHandler(env,{logger:{log:(value) => logs.push(value),error:(value) => logs.push(value)}}))
  const call = async (route,{method='GET',cookie,body,headers={}}={}) => {
    const response = await fetch(`${app.url}${route}`,{method,headers:{...(cookie ? {cookie} : {}),...(body !== undefined ? {'content-type':'application/json'} : {}),...headers},body:body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)})
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],requestId:response.headers.get('x-request-id')}
  }
  try {
    const beforeReads = storage.snapshotReadCount
    const login = await call('/admin/login',{method:'POST',body:{username:'admin',password:initialPassword}})
    assert.equal(login.status,200)
    assert.equal((await call('/admin/users',{cookie:login.cookie})).status,403)
    assert.equal((await call('/admin/change-password',{method:'POST',cookie:login.cookie,body:{currentPassword:initialPassword,newPassword:changedPassword}})).data.code,'CSRF_REQUIRED')
    const change = await call('/admin/change-password',{method:'POST',cookie:login.cookie,headers:{'x-lumirror-request':'fetch'},body:{currentPassword:initialPassword,newPassword:changedPassword}})
    assert.equal(change.status,200)
    assert.ok(change.cookie)
    assert.equal((await call('/admin/me',{cookie:login.cookie})).status,401)
    assert.equal((await call('/admin/me',{cookie:change.cookie})).status,200)
    assert.equal((await call('/admin/employees?limit=2',{cookie:change.cookie})).data.data.items.length,2)
    assert.equal((await call('/health')).status,200)
    assert.equal(storage.snapshotReadCount,beforeReads)
    const invalid = await call('/admin/login',{method:'POST',body:'{broken'})
    assert.equal(invalid.status,400)
    assert.equal(invalid.data.code,'INVALID_JSON')
    assert.equal(invalid.data.requestId,invalid.requestId)
    assert.equal((await call('/admin/login',{method:'POST',headers:{origin:'https://untrusted.invalid'},body:{username:'admin',password:changedPassword}})).status,403)
    assert.equal((await call('/admin/login',{method:'PUT',body:{}})).status,405)
    const large = await call('/admin/login',{method:'POST',body:JSON.stringify({password:'x'.repeat(2*1024*1024)})})
    assert.equal(large.status,413)
    assert.equal(JSON.stringify(logs).includes(initialPassword),false)
    assert.equal(JSON.stringify(logs).includes(changedPassword),false)
    assert.equal(logs.some((line) => JSON.parse(line).requestId === invalid.requestId),true)
  } finally { await app.close(); storage.close() }
})

test('unexpected exceptions are logged once without raw error messages',async () => {
  const records = []
  const secret = 'DO_NOT_LOG_THIS_PASSWORD'
  const app = await listen(createRequestHandler({TRUST_PROXY:'false'},{dispatch:() => { throw new Error(secret) },logger:{log:(record) => records.push(JSON.parse(record)),error:(record) => records.push(JSON.parse(record))}}))
  try {
    const response = await fetch(`${app.url}/private/${secret}`)
    const body = await response.json()
    assert.equal(response.status,500)
    assert.equal(body.code,'INTERNAL_ERROR')
    assert.equal(body.requestId,response.headers.get('x-request-id'))
    assert.equal(records.filter((record) => record.errorType === 'Error').length,1)
    assert.ok(records.every((record) => record.requestId === body.requestId))
    assert.equal(JSON.stringify(records).includes(secret),false)
  } finally { await app.close() }
})
