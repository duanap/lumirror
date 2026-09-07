import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'

const projectRoot = path.resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'lumirror-r2-concurrency-'))
const initialPassword = 'r2-concurrency-initial'
const changedPassword = 'r2-concurrency-changed'

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

const port = await availablePort()
const child = spawn(process.execPath, ['scripts/production-server.mjs'], {
  cwd:projectRoot,
  env:{...process.env,LUMIRROR_REQUEST_QUEUE:'off',APP_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dataDir,ADMIN_TOKEN_SECRET:'r2-admin-secret',PUBLIC_TOKEN_SECRET:'r2-public-secret',INITIAL_ADMIN_PASSWORD:initialPassword},
  stdio:['ignore','ignore','pipe']
})
let stderr = ''
child.stderr.on('data', (chunk) => { stderr += chunk })
const baseUrl = `http://127.0.0.1:${port}/api`

async function stop() {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
}

async function call(route, { method = 'GET', token, cookie, body } = {}) {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (cookie) headers.set('cookie', cookie)
  if (cookie && route.startsWith('/admin') && method !== 'GET') headers.set('x-lumirror-request', 'fetch')
  if (body) headers.set('content-type', 'application/json')
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body:body ? JSON.stringify(body) : undefined })
  return { status:response.status, payload:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] || cookie || '' }
}

async function waitReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${stderr}`)
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.status === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`server did not become ready: ${stderr}`)
}

async function createActivity(adminCookie, name, participantEmployeeIds, targetEmployeeIds) {
  const now = Date.now()
  const response = await call('/admin/evaluation-activities/create-flow', {
    method:'POST',cookie:adminCookie,
    body:{name,teamId:'team_rd',participantMode:'selected',participantEmployeeIds,targetType:'employee',targetMode:'selected',targetEmployeeIds,excludeSelf:false,startTime:new Date(now - 60_000).toISOString(),endTime:new Date(now + 86_400_000).toISOString()}
  })
  assert.equal(response.status,200)
  return response.payload.data
}

async function entry(activity, verify) {
  const response = await call('/public/verify-entry',{method:'POST',body:{evaluationCode:activity.linkCode,verifyCode:verify.code}})
  assert.equal(response.status,200)
  return response.payload.token
}

async function current(token) {
  const response = await call('/public/current-task',{token})
  return response
}

try {
  await waitReady()
  const login = await call('/admin/login',{method:'POST',body:{username:'admin',password:initialPassword}})
  assert.equal(login.status,200)
  const adminCookie = login.cookie
  assert.equal((await call('/admin/change-password',{method:'POST',cookie:adminCookie,body:{currentPassword:initialPassword,newPassword:changedPassword,confirmPassword:changedPassword}})).status,200)

  const mixedWrites = await Promise.all([
    ...Array.from({length:5},(_,index) => call('/admin/periods',{method:'POST',cookie:adminCookie,body:{name:`R2并发周期${index}`,startTime:new Date(Date.now()-60_000).toISOString(),endTime:new Date(Date.now()+86_400_000).toISOString(),status:'active'}})),
    ...Array.from({length:5},(_,index) => call('/admin/employees',{method:'POST',cookie:adminCookie,body:{name:`R2并发成员${index}`,gender:'unknown',departmentId:'dep_rd',teamId:'team_rd',position:'并发测试',status:'active',avatar:'',tagIds:[]}})),
    ...Array.from({length:5},(_,index) => call('/admin/settings',{method:'PUT',cookie:adminCookie,body:{systemName:`和光镜鉴并发${index}`,publicSessionMinutes:90,logRetentionDays:120}})),
    ...Array.from({length:5},() => call('/admin/employees',{cookie:adminCookie})),
    ...Array.from({length:5},() => call('/admin/periods',{cookie:adminCookie}))
  ])
  assert.ok(mixedWrites.every((item) => item.status === 200))

  const updateUser = await call('/admin/users',{method:'POST',cookie:adminCookie,body:{username:'r2_concurrent_user',displayName:'并发用户',password:'r2-concurrent-password',role:'team_leader',teamId:'team_rd',departmentId:'dep_rd',status:'active',mustChangePassword:false}})
  assert.equal(updateUser.status,200)
  const userUpdates = await Promise.all([1,2,3].map((index) => call(`/admin/users/${updateUser.payload.data.id}`,{method:'PUT',cookie:adminCookie,body:{displayName:`并发用户${index}`,role:'team_leader',teamId:'team_rd',departmentId:'dep_rd',status:'active'}})))
  assert.ok(userUpdates.every((item) => item.status === 200))

  const differentTasks = await createActivity(adminCookie,'R2并发不同任务',['emp_001','emp_002'],['emp_003','emp_004'])
  const activityUpdates = await Promise.all([1,2].map((index) => call(`/admin/evaluation-codes/${differentTasks.activity.id}`,{method:'PUT',cookie:adminCookie,body:{name:`R2活动并发更新${index}`}})))
  assert.ok(activityUpdates.every((item) => item.status === 200))
  const verifyGenerations = await Promise.all([1,2,3,4].map(() => call('/admin/verify-codes/generate',{method:'POST',cookie:adminCookie,body:{evaluationCodeId:differentTasks.activity.id,count:1}})))
  assert.ok(verifyGenerations.every((item) => item.status === 200))
  const tokenA = await entry(differentTasks.activity,differentTasks.verifyCodes[0])
  const tokenB = await entry(differentTasks.activity,differentTasks.verifyCodes[1])
  const taskA = await current(tokenA)
  const taskB = await current(tokenB)
  assert.equal(taskA.status,200)
  assert.equal(taskB.status,200)
  const differentResults = await Promise.all([
    call('/public/submit-score',{method:'POST',token:tokenA,body:{taskId:taskA.payload.data.id,scores:{ability:90,attitude:90,collaboration:90}}}),
    call('/public/submit-score',{method:'POST',token:tokenB,body:{taskId:taskB.payload.data.id,scores:{ability:91,attitude:91,collaboration:91}}})
  ])
  assert.deepEqual(differentResults.map((item) => item.status).sort(),[200,200])

  const sameTask = await createActivity(adminCookie,'R2并发同一任务',['emp_001'],['emp_003'])
  const sameToken = await entry(sameTask.activity,sameTask.verifyCodes[0])
  const sameCurrent = await current(sameToken)
  const sameResults = await Promise.all([1,2].map(() => call('/public/submit-score',{method:'POST',token:sameToken,body:{taskId:sameCurrent.payload.data.id,scores:{ability:90,attitude:90,collaboration:90}}})))
  assert.deepEqual(sameResults.map((item) => item.status).sort(),[200,409])
  assert.equal(sameResults.find((item) => item.status === 409).payload.code,'TASK_ALREADY_SUBMITTED')

  const readRace = await createActivity(adminCookie,'R2并发读取',['emp_001'],['emp_004'])
  const readToken = await entry(readRace.activity,readRace.verifyCodes[0])
  const readCurrent = await current(readToken)
  const [submitResult, resultsResult, trendsResult] = await Promise.all([
    call('/public/submit-score',{method:'POST',token:readToken,body:{taskId:readCurrent.payload.data.id,scores:{ability:92,attitude:92,collaboration:92}}}),
    call(`/admin/results?evaluationCodeId=${readRace.activity.id}`,{cookie:adminCookie}),
    call('/admin/trends?targetType=employee&targetId=emp_004',{cookie:adminCookie})
  ])
  assert.equal(submitResult.status,200)
  assert.equal(resultsResult.status,200)
  assert.equal(trendsResult.status,200)
  assert.ok(![submitResult,resultsResult,trendsResult].some((item) => item.status === 500))

  const afterSubmit = await Promise.all([1,2,3].map(() => current(sameToken)))
  assert.ok(afterSubmit.every((item) => item.status === 404))
  const { DatabaseSync } = await import('node:sqlite')
  const database = new DatabaseSync(path.join(dataDir,'lumirror.sqlite'))
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check,'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0)
  assert.ok(database.prepare('SELECT COUNT(*) AS value FROM employees WHERE name LIKE \'R2并发成员%\'').get().value >= 5)
  assert.ok(database.prepare('SELECT COUNT(*) AS value FROM review_periods WHERE name LIKE \'R2并发周期%\'').get().value >= 5)
  assert.ok(database.prepare("SELECT COUNT(*) AS value FROM audit_logs WHERE action IN ('score.submit','evaluation.create','user.update','settings.update')").get().value > 0)
  database.close()
  console.log('R2 concurrency gate passed: different tasks, duplicate task, results/trends reads and post-submit current-task')
} finally {
  await stop()
  await rm(dataDir,{recursive:true,force:true})
}
