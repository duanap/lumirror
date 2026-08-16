import assert from 'node:assert/strict'
import onRequest from '../edge-functions/api/[[default]].js'

const env = { APP_ENV:'development', ADMIN_TOKEN_SECRET:'test-admin-secret', PUBLIC_TOKEN_SECRET:'test-public-secret' }

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

const health = await call('/health')
assert.equal(health.payload.data.version,'1.4.1')
assert.equal(health.payload.data.ready,true)

const productionHealth = await onRequest({
  request:new Request('https://example.com/api/health'),
  params:{},
  env:{ APP_ENV:'production', ADMIN_TOKEN_SECRET:'test-admin-secret', PUBLIC_TOKEN_SECRET:'test-public-secret', INITIAL_ADMIN_PASSWORD:'temporary-password' }
})
assert.equal(productionHealth.status,503)
assert.equal((await productionHealth.json()).data.kvBound,false)
const productionLogin = await onRequest({
  request:new Request('https://example.com/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'temporary-password'})}),
  params:{},
  env:{ APP_ENV:'production', ADMIN_TOKEN_SECRET:'test-admin-secret', PUBLIC_TOKEN_SECRET:'test-public-secret', INITIAL_ADMIN_PASSWORD:'temporary-password' }
})
assert.equal(productionLogin.status,503)
assert.equal((await productionLogin.json()).code,'KV_NOT_BOUND')

const login = await call('/admin/login',{method:'POST',body:{username:'admin',password:'admin123'}})
assert.equal(login.status,200)
assert.ok(login.cookie.startsWith('lumirror_admin='))
assert.equal(login.payload.user.role,'admin')
assert.equal(login.payload.user.mustChangePassword,true)
let adminCookie = login.cookie

const me = await call('/admin/me',{cookie:adminCookie})
assert.equal(me.payload.data.roleLabel,'管理员')

const lockedBeforePasswordChange = await call('/admin/employees?teamId=team_rd&status=active',{cookie:adminCookie})
assert.equal(lockedBeforePasswordChange.status,403)
assert.equal(lockedBeforePasswordChange.payload.code,'PASSWORD_CHANGE_REQUIRED')
const adminPasswordChange = await call('/admin/change-password',{
  method:'POST',cookie:adminCookie,
  body:{currentPassword:'admin123',newPassword:'admin12345',confirmPassword:'admin12345'}
})
assert.equal(adminPasswordChange.status,200)

const publicSessionSettings = await call('/admin/settings',{
  method:'PUT',cookie:adminCookie,
  body:{publicSessionMinutes:15}
})
assert.equal(publicSessionSettings.status,200)
assert.equal(publicSessionSettings.payload.data.publicSessionMinutes,15)

const employeeList = await call('/admin/employees?teamId=team_rd&status=active',{cookie:adminCookie})
assert.equal(employeeList.status,200)
assert.ok(employeeList.payload.data.items.length >= 5)
assert.ok(employeeList.payload.data.items.every((x) => x.teamId === 'team_rd'))
const avatarUpdate = await call('/admin/employees/emp_003',{
  method:'PUT',cookie:adminCookie,
  body:{name:'王敏',gender:'female',departmentId:'dep_rd',teamId:'team_rd',position:'产品经理',status:'active',avatar:'avatar_female_young_plain'}
})
assert.equal(avatarUpdate.status,200)
assert.equal(avatarUpdate.payload.data.avatar,'avatar_female_young_plain')
const mismatchedAvatarUpdate = await call('/admin/employees/emp_001',{
  method:'PUT',cookie:adminCookie,
  body:{name:'张三',gender:'male',departmentId:'dep_rd',teamId:'team_rd',position:'研发工程师',status:'active',avatar:'avatar_female_young_plain'}
})
assert.equal(mismatchedAvatarUpdate.status,200)
assert.equal(mismatchedAvatarUpdate.payload.data.avatar,'')

const createdUser = await call('/admin/users',{
  method:'POST',cookie:adminCookie,
  body:{username:'teamlead1',displayName:'研发团队长',password:'teamlead123',role:'team_leader',teamId:'team_rd',departmentId:'dep_rd',status:'active'}
})
assert.equal(createdUser.status,200)
const teamLogin = await call('/admin/login',{method:'POST',body:{username:'teamlead1',password:'teamlead123'}})
assert.equal(teamLogin.status,200)
const teamCookie = teamLogin.cookie
assert.equal(teamLogin.payload.user.mustChangePassword,true)
const teamPasswordChange = await call('/admin/change-password',{
  method:'POST',cookie:teamCookie,
  body:{currentPassword:'teamlead123',newPassword:'teamlead1234',confirmPassword:'teamlead1234'}
})
assert.equal(teamPasswordChange.status,200)
const forbiddenUsers = await call('/admin/users',{cookie:teamCookie})
assert.equal(forbiddenUsers.status,403)
const scopedEmployees = await call('/admin/employees',{cookie:teamCookie})
assert.equal(scopedEmployees.status,200)
assert.ok(scopedEmployees.payload.data.items.every((x) => x.teamId === 'team_rd'))

const start = new Date(Date.now()-60_000).toISOString()
const end = new Date(Date.now()+86_400_000).toISOString()

const createdMember = await call('/admin/users',{
  method:'POST',cookie:adminCookie,
  body:{username:'member1',displayName:'普通成员',password:'member123',role:'member',employeeId:'emp_003',status:'active'}
})
assert.equal(createdMember.status,200)
const memberLogin = await call('/admin/login',{method:'POST',body:{username:'member1',password:'member123'}})
assert.equal(memberLogin.status,200)
const memberCookie = memberLogin.cookie
assert.equal(memberLogin.payload.user.mustChangePassword,true)
const memberPasswordChange = await call('/admin/change-password',{
  method:'POST',cookie:memberCookie,
  body:{currentPassword:'member123',newPassword:'member1234',confirmPassword:'member1234'}
})
assert.equal(memberPasswordChange.status,200)
const memberDashboard = await call('/admin/dashboard',{cookie:memberCookie})
assert.equal(memberDashboard.status,200)
assert.equal(memberDashboard.payload.data.mode,'member')
assert.equal(memberDashboard.payload.data.completionRate,null)
const memberResults = await call('/admin/results',{cookie:memberCookie})
assert.equal(memberResults.status,403)

const outOfScope = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:teamCookie,
  body:{name:'越权活动',teamId:'team_pm',participantMode:'quantity',participantCount:1,targetMode:'all',startTime:start,endTime:end}
})
assert.equal(outOfScope.status,400)
const created = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{
    name:'v1.2流程测试活动',teamId:'team_rd',participantMode:'selected',
    participantEmployeeIds:['emp_001','emp_002'],targetMode:'selected',targetEmployeeIds:['emp_001','emp_002','emp_003'],
    excludeSelf:true,startTime:start,endTime:end
  }
})
assert.equal(created.status,200)
assert.match(created.payload.data.activity.code,/^PJ\d{4}$/)
assert.match(created.payload.data.activity.linkCode,/^\d{8}$/)
assert.equal(created.payload.data.verifyCodes.length,2)
assert.ok(created.payload.data.verifyCodes.every((item) => /^\d{6}$/.test(item.code)))
assert.equal(created.payload.data.targetCount,3)
assert.equal(created.payload.data.taskCount,4)

const evaluationCode = created.payload.data.activity.linkCode
const verifyCode = created.payload.data.verifyCodes[0].code
const wrongVerifyCode = verifyCode === '000000' ? '000001' : '000000'
const evaluationTitle = await call('/public/evaluation-title',{method:'POST',body:{linkCode:evaluationCode}})
assert.equal(evaluationTitle.status,200)
assert.equal(evaluationTitle.payload.data.name,'v1.2流程测试活动')
const missingEvaluationTitle = await call('/public/evaluation-title',{method:'POST',body:{linkCode:'00000000'}})
assert.equal(missingEvaluationTitle.status,404)
const legacyActivityCode = await call('/public/verify-entry',{method:'POST',body:{evaluationCode:created.payload.data.activity.code,verifyCode}})
assert.equal(legacyActivityCode.status,404)
const wrongPair = await call('/public/verify-entry',{method:'POST',body:{evaluationCode,verifyCode:wrongVerifyCode}})
assert.equal(wrongPair.status,403)

const entryRequestedAt = Math.floor(Date.now() / 1000)
const entry = await call('/public/verify-entry',{method:'POST',body:{evaluationCode,verifyCode}})
const entryReturnedAt = Math.floor(Date.now() / 1000)
assert.equal(entry.status,200)
assert.equal(entry.payload.remaining,2)
const entryTokenPayload = JSON.parse(Buffer.from(entry.payload.token.split('.')[0],'base64url').toString('utf8'))
assert.ok(entryTokenPayload.exp >= entryRequestedAt + 900)
assert.ok(entryTokenPayload.exp <= entryReturnedAt + 900)

const firstTask = await call('/public/current-task',{token:entry.payload.token})
assert.equal(firstTask.status,200)
assert.notEqual(firstTask.payload.data.target.id,'emp_001')
const invalid = await call('/public/submit-score',{
  method:'POST',token:entry.payload.token,
  body:{taskId:firstTask.payload.data.id,scores:{ability:555,attitude:88,collaboration:86}}
})
assert.equal(invalid.status,400)

let remaining = 2
while (remaining > 0) {
  const task = await call('/public/current-task',{token:entry.payload.token})
  assert.equal(task.status,200)
  const submit = await call('/public/submit-score',{
    method:'POST',token:entry.payload.token,
    body:{taskId:task.payload.data.id,scores:{ability:92,attitude:88,collaboration:86}}
  })
  assert.equal(submit.status,200)
  assert.equal(submit.payload.data.total,88.7)
  remaining = submit.payload.data.remaining
}

const reuse = await call('/public/verify-entry',{method:'POST',body:{evaluationCode,verifyCode}})
assert.equal(reuse.status,403)
assert.equal(reuse.payload.code,'COMPLETED')

const activities = await call('/admin/evaluation-codes',{cookie:adminCookie})
const row = activities.payload.data.items.find((x) => x.id === created.payload.data.activity.id)
assert.equal(row.completionRate,50)

const results = await call(`/admin/results?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
assert.equal(results.status,200)
assert.equal(results.payload.data.items.length,3)
assert.ok(results.payload.data.items.every((x) => x.teamName === '研发团队'))

const customRules = [
  {id:'quality',name:'交付质量',min:60,max:99,weight:100,operation:'add',enabled:true},
  {id:'bonus',name:'额外贡献',min:0,max:20,weight:10,operation:'add',enabled:true},
  {id:'penalty',name:'风险扣减',min:0,max:20,weight:10,operation:'subtract',enabled:true}
]
const customActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{
    name:'自定义维度测试活动',teamId:'team_rd',participantMode:'quantity',participantCount:1,
    targetMode:'selected',targetEmployeeIds:['emp_003'],excludeSelf:true,periodMode:'new',periodName:'自定义维度测试周期',
    startTime:start,endTime:end,rules:customRules,rounding:'one_decimal'
  }
})
assert.equal(customActivity.status,200)
assert.equal(customActivity.payload.data.period.name,'自定义维度测试周期')
assert.ok(customActivity.payload.data.activity.periodId)
const invalidCustomRules = await call('/admin/settings/score-rules',{
  method:'PUT',cookie:adminCookie,
  body:{evaluationCodeId:customActivity.payload.data.activity.id,rules:[...customRules.slice(0,2)],rounding:'one_decimal'}
})
assert.equal(invalidCustomRules.status,400)
const customEntry = await call('/public/verify-entry',{
  method:'POST',body:{evaluationCode:customActivity.payload.data.activity.linkCode,verifyCode:customActivity.payload.data.verifyCodes[0].code}
})
assert.equal(customEntry.status,200)
const customTask = await call('/public/current-task',{token:customEntry.payload.token})
assert.deepEqual(customTask.payload.data.rules.map((rule) => rule.operation),['add','add','subtract'])
assert.equal(customTask.payload.data.target.avatar,'avatar_female_young_plain')
const customSubmit = await call('/public/submit-score',{
  method:'POST',token:customEntry.payload.token,
  body:{taskId:customTask.payload.data.id,scores:{quality:90,bonus:10,penalty:5}}
})
assert.equal(customSubmit.status,200)
assert.equal(customSubmit.payload.data.total,90.5)
const customResults = await call(`/admin/results?evaluationCodeId=${customActivity.payload.data.activity.id}`,{cookie:adminCookie})
assert.deepEqual(customResults.payload.data.rules.map((rule) => rule.id),['quality','bonus','penalty'])
assert.equal(customResults.payload.data.items.find((item) => item.id === 'emp_003').values.penalty,5)

const existingPeriodActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{
    name:'已有周期测试活动',teamId:'team_rd',participantMode:'quantity',participantCount:1,
    targetMode:'selected',targetEmployeeIds:['emp_004'],excludeSelf:true,periodMode:'existing',periodId:customActivity.payload.data.period.id,
    startTime:start,endTime:end
  }
})
assert.equal(existingPeriodActivity.status,200)
assert.equal(existingPeriodActivity.payload.data.activity.periodId,customActivity.payload.data.period.id)

const timed = await call('/admin/timed-invites/generate',{
  method:'POST',cookie:adminCookie,
  body:{evaluationCodeId:created.payload.data.activity.id}
})
assert.equal(timed.status,200)
assert.match(timed.payload.data.linkCode,/^\d{8}$/)
const timedEntry = await call('/public/timed-entry',{method:'POST',body:{linkCode:timed.payload.data.linkCode}})
assert.equal(timedEntry.status,200)
assert.ok(timedEntry.payload.expiresAt)
let timedRemaining = timedEntry.payload.remaining
while (timedRemaining > 0) {
  const task = await call('/public/current-task',{token:timedEntry.payload.token})
  assert.equal(task.status,200)
  assert.ok(task.payload.data.timed)
  assert.ok(task.payload.data.expiresAt)
  const submit = await call('/public/submit-score',{
    method:'POST',token:timedEntry.payload.token,
    body:{taskId:task.payload.data.id,scores:{ability:90,attitude:90,collaboration:90}}
  })
  assert.equal(submit.status,200)
  timedRemaining = submit.payload.data.remaining
}
const timedReuse = await call('/public/timed-entry',{method:'POST',body:{linkCode:timed.payload.data.linkCode}})
assert.equal(timedReuse.status,404)

const disposable = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'可删除测试活动',teamId:'team_rd',participantMode:'quantity',participantCount:1,targetMode:'selected',targetEmployeeIds:['emp_003'],excludeSelf:true,startTime:start,endTime:end}
})
assert.equal(disposable.status,200)
const deletedActivity = await call('/admin/batch',{
  method:'POST',cookie:adminCookie,
  body:{resource:'evaluation-codes',action:'delete',ids:[disposable.payload.data.activity.id]}
})
assert.equal(deletedActivity.status,200)
assert.equal(deletedActivity.payload.data.successCount,1)

const verifyRows = await call(`/admin/verify-codes?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
const unused = verifyRows.payload.data.items.find((x) => x.status === 'unused')
assert.ok(unused)
const removed = await call('/admin/batch',{
  method:'POST',cookie:adminCookie,
  body:{resource:'verify-codes',action:'delete',ids:[unused.id]}
})
assert.equal(removed.status,200)
assert.equal(removed.payload.data.successCount,1)

const batchStatus = await call('/admin/batch',{
  method:'POST',cookie:adminCookie,
  body:{resource:'evaluation-codes',action:'status',ids:[created.payload.data.activity.id],status:'archived'}
})
assert.equal(batchStatus.status,200)
assert.equal(batchStatus.payload.data.successCount,1)
assert.equal(batchStatus.payload.data.failureCount,0)

const failedBatch = await call('/admin/batch',{
  method:'POST',cookie:adminCookie,
  body:{resource:'users',action:'delete',ids:['user_admin','missing_user']}
})
assert.equal(failedBatch.status,200)
assert.equal(failedBatch.payload.data.successCount,0)
assert.equal(failedBatch.payload.data.failureCount,2)
assert.ok(failedBatch.payload.data.items.some((x) => x.message.includes('当前登录账号')))

const exported = await call('/admin/export/json',{cookie:adminCookie})
assert.equal(exported.status,200)
assert.ok(exported.payload.data.verifyCodes.every((x) => x.code === '[REDACTED]' && x.codeHash === '[HASH]'))
const fullExport = await call('/admin/export/full-json',{method:'POST',cookie:adminCookie,body:{confirm:'EXPORT_FULL_BACKUP'}})
assert.equal(fullExport.status,200)
assert.ok(fullExport.payload.data.verifyCodes.some((x) => /^\d{6}$/.test(String(x.code || ''))))
const deployment = await call('/admin/deployment-check',{cookie:adminCookie})
assert.equal(deployment.status,200)
assert.ok(Array.isArray(deployment.payload.data.checks))
const cleanup = await call('/admin/maintenance/cleanup',{method:'POST',cookie:adminCookie})
assert.equal(cleanup.status,200)
const logs = await call('/admin/logs?limit=10',{cookie:adminCookie})
assert.equal(logs.status,200)
assert.ok(logs.payload.data.items.length >= 1)
const badImport = await call('/admin/import/json',{method:'POST',cookie:adminCookie,body:{data:{employees:[]}}})
assert.equal(badImport.status,400)
assert.match(badImport.payload.message,/缺少|结构无效/)

const logout = await call('/admin/logout',{method:'POST',cookie:adminCookie})
assert.equal(logout.status,200)
assert.ok(logout.cookie.startsWith('lumirror_admin='))

console.log('API smoke test passed: auth/RBAC, periods, custom add/subtract score rules, dynamic results, invitations, strict validation, batch ops, exports, maintenance and import validation')
