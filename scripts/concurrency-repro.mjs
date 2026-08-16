import assert from 'node:assert/strict'
import onRequest from '../edge-functions/api/[[default]].js'

const DATABASE_KEY = 'employee_review_db_v1'

class InterleavingKV {
  values = new Map()
  readGate = null

  armConcurrentReads(count) {
    this.readGate = { remaining:count, waiting:[], active:true }
  }

  async get(key, options = {}) {
    const snapshot = this.values.get(key) ?? null
    const gate = this.readGate
    if (key === DATABASE_KEY && gate?.active) {
      gate.remaining -= 1
      if (gate.remaining === 0) {
        gate.active = false
        for (const release of gate.waiting) release()
      } else {
        await new Promise((resolve) => gate.waiting.push(resolve))
      }
    }
    return options.type === 'json' && snapshot !== null ? JSON.parse(snapshot) : snapshot
  }

  async put(key, value) {
    this.values.set(key,String(value))
  }
}

const kv = new InterleavingKV()
const env = {
  APP_ENV:'development',
  ADMIN_TOKEN_SECRET:'test-admin-secret',
  PUBLIC_TOKEN_SECRET:'test-public-secret',
  EVALUATION_KV:kv
}

async function call(path,{method='GET',token,cookie,body}={}) {
  const headers = new Headers()
  if (token) headers.set('authorization',`Bearer ${token}`)
  if (cookie) headers.set('cookie',cookie)
  if (cookie && path.startsWith('/admin') && method !== 'GET') headers.set('x-lumirror-request','fetch')
  if (body) headers.set('content-type','application/json')
  const request = new Request(`http://localhost/api${path}`,{method,headers,body:body?JSON.stringify(body):undefined})
  const response = await onRequest({request,params:{},env})
  const setCookie = response.headers.get('set-cookie')
  return {status:response.status,payload:await response.json(),cookie:setCookie?.split(';')[0] || cookie || ''}
}

const login = await call('/admin/login',{method:'POST',body:{username:'admin',password:'admin123'}})
assert.equal(login.status,200)
const adminCookie = login.cookie

const passwordChange = await call('/admin/change-password',{
  method:'POST',cookie:adminCookie,
  body:{currentPassword:'admin123',newPassword:'admin12345',confirmPassword:'admin12345'}
})
assert.equal(passwordChange.status,200)

const now = Date.now()
const created = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{
    name:'并发写入复现',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],
    targetMode:'selected',targetEmployeeIds:['emp_002','emp_003'],excludeSelf:true,
    startTime:new Date(now - 60_000).toISOString(),endTime:new Date(now + 86_400_000).toISOString()
  }
})
assert.equal(created.status,200)
assert.equal(created.payload.data.taskCount,2)

const activity = created.payload.data.activity
const verify = created.payload.data.verifyCodes[0]
const entry = await call('/public/verify-entry',{
  method:'POST',body:{evaluationCode:activity.linkCode,verifyCode:verify.code}
})
assert.equal(entry.status,200)

const tasks = await call(`/admin/tasks?evaluationCodeId=${activity.id}`,{cookie:adminCookie})
assert.equal(tasks.status,200)
const taskIds = tasks.payload.data.items.filter((item) => item.verifyCodeId === verify.id).map((item) => item.id)
assert.equal(taskIds.length,2)

kv.armConcurrentReads(2)
const submissions = await Promise.all(taskIds.map((taskId) => call('/public/submit-score',{
  method:'POST',token:entry.payload.token,
  body:{taskId,scores:{ability:90,attitude:90,collaboration:90}}
})))
assert.ok(submissions.every((submission) => submission.status === 200))

const results = await call(`/admin/results?evaluationCodeId=${activity.id}`,{cookie:adminCookie})
assert.equal(results.status,200)
const persistedReviewCount = results.payload.data.items.reduce((total,item) => total + Number(item.reviewCount || 0),0)
assert.equal(persistedReviewCount,2,'both successful submissions must remain visible in persisted results')

console.log('Concurrency test passed: both successful score submissions were preserved')
