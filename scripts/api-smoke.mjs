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
assert.equal(health.payload.data.version,'1.5.0')
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
assert.ok(employeeList.payload.data.items.every((x) => Array.isArray(x.tagIds) && Array.isArray(x.tags)))
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

const coreTag = await call('/admin/member-tags',{
  method:'POST',cookie:adminCookie,body:{name:'骨干'}
})
assert.equal(coreTag.status,200)
const leadTag = await call('/admin/member-tags',{
  method:'POST',cookie:adminCookie,body:{name:'组长'}
})
assert.equal(leadTag.status,200)
const duplicateTag = await call('/admin/member-tags',{
  method:'POST',cookie:adminCookie,body:{name:' 骨干 '}
})
assert.equal(duplicateTag.status,409)
const taggedEmployee = await call('/admin/employees/emp_003',{
  method:'PUT',cookie:adminCookie,
  body:{name:'王敏',gender:'female',departmentId:'dep_rd',teamId:'team_rd',position:'产品经理',status:'active',avatar:'avatar_female_young_plain',tagIds:[coreTag.payload.data.id,leadTag.payload.data.id]}
})
assert.equal(taggedEmployee.status,200)
assert.deepEqual(taggedEmployee.payload.data.tagIds,[coreTag.payload.data.id,leadTag.payload.data.id])
const createdEmployee = await call('/admin/employees',{
  method:'POST',cookie:adminCookie,
  body:{name:'标签测试成员',gender:'male',departmentId:'dep_rd',teamId:'team_rd',position:'工程师',status:'active',avatar:'avatar_male_young_plain',tagIds:[coreTag.payload.data.id]}
})
assert.equal(createdEmployee.status,200)
assert.deepEqual(createdEmployee.payload.data.tagIds,[coreTag.payload.data.id])
const renamedTag = await call(`/admin/member-tags/${leadTag.payload.data.id}`,{
  method:'PUT',cookie:adminCookie,body:{name:'负责人'}
})
assert.equal(renamedTag.status,200)
const deletedTag = await call(`/admin/member-tags/${leadTag.payload.data.id}`,{method:'DELETE',cookie:adminCookie})
assert.equal(deletedTag.status,200)
assert.equal(deletedTag.payload.data.detachedCount,1)
const employeesAfterTagDelete = await call('/admin/employees',{cookie:adminCookie})
const preservedEmployee = employeesAfterTagDelete.payload.data.items.find((item) => item.id === 'emp_003')
assert.ok(preservedEmployee)
assert.deepEqual(preservedEmployee.tagIds,[coreTag.payload.data.id])
assert.equal(preservedEmployee.tags[0].name,'骨干')

const backendTeam = await call('/admin/teams',{
  method:'POST',cookie:adminCookie,
  body:{name:'后端组',departmentId:'dep_rd',leader:'',sort:3,status:'active'}
})
assert.equal(backendTeam.status,200)
const backendEmployee = await call('/admin/employees',{
  method:'POST',cookie:adminCookie,
  body:{name:'后端成员',gender:'male',departmentId:'dep_rd',teamId:backendTeam.payload.data.id,position:'后端工程师',status:'active',avatar:'',tagIds:[]}
})
assert.equal(backendEmployee.status,200)
const inactiveBackendEmployee = await call('/admin/employees',{
  method:'POST',cookie:adminCookie,
  body:{name:'停用成员',gender:'female',departmentId:'dep_rd',teamId:backendTeam.payload.data.id,position:'后端工程师',status:'inactive',avatar:'',tagIds:[]}
})
assert.equal(inactiveBackendEmployee.status,200)

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
const forbiddenTagRename = await call(`/admin/member-tags/${coreTag.payload.data.id}`,{
  method:'PUT',cookie:teamCookie,body:{name:'越权重命名'}
})
assert.equal(forbiddenTagRename.status,403)

const directUser = await call('/admin/users',{
  method:'POST',cookie:adminCookie,
  body:{username:'directlead',displayName:'无需首次改密账号',password:'directlead123',role:'team_leader',teamId:'team_rd',departmentId:'dep_rd',status:'active',mustChangePassword:false}
})
assert.equal(directUser.status,200)
assert.equal(directUser.payload.data.mustChangePassword,false)
const directLogin = await call('/admin/login',{method:'POST',body:{username:'directlead',password:'directlead123'}})
assert.equal(directLogin.status,200)
assert.equal(directLogin.payload.user.mustChangePassword,false)
const directDashboard = await call('/admin/dashboard',{cookie:directLogin.cookie})
assert.equal(directDashboard.status,200)
const forbiddenUsers = await call('/admin/users',{cookie:teamCookie})
assert.equal(forbiddenUsers.status,403)
const scopedEmployees = await call('/admin/employees',{cookie:teamCookie})
assert.equal(scopedEmployees.status,200)
assert.ok(scopedEmployees.payload.data.items.every((x) => x.teamId === 'team_rd'))

const start = new Date(Date.now()-60_000).toISOString()
const end = new Date(Date.now()+86_400_000).toISOString()

const boundedPeriod = await call('/admin/periods',{
  method:'POST',cookie:adminCookie,
  body:{name:'范围约束测试周期',startTime:new Date(Date.now()-3_600_000).toISOString(),endTime:new Date(Date.now()+2*86_400_000).toISOString(),status:'active'}
})
assert.equal(boundedPeriod.status,200)
const singleTeamActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'单团队成员评价',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',employeeTargetScope:'team',targetTeamId:'team_rd',excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(singleTeamActivity.status,200)
assert.equal(singleTeamActivity.payload.data.activity.employeeTargetScope,'team')
assert.equal(singleTeamActivity.payload.data.taskCount,singleTeamActivity.payload.data.targetCount-1)

const departmentActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'跨团队部门成员评价',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',employeeTargetScope:'department',targetDepartmentId:'dep_rd',excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(departmentActivity.status,200)
assert.equal(departmentActivity.payload.data.activity.employeeTargetScope,'department')
assert.ok(departmentActivity.payload.data.activity.targetEmployeeIds.includes(backendEmployee.payload.data.id))
assert.ok(!departmentActivity.payload.data.activity.targetEmployeeIds.includes(inactiveBackendEmployee.payload.data.id))
assert.equal(departmentActivity.payload.data.taskCount,departmentActivity.payload.data.targetCount-1)

const departmentParticipantsActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'跨团队部门参与者',teamId:'team_rd',participantMode:'selected',participantScope:'department',participantDepartmentId:'dep_rd',participantEmployeeIds:['emp_001',backendEmployee.payload.data.id,inactiveBackendEmployee.payload.data.id],targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:['emp_002'],excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(departmentParticipantsActivity.status,200)
assert.equal(departmentParticipantsActivity.payload.data.activity.participantScope,'department')
assert.deepEqual(departmentParticipantsActivity.payload.data.activity.participantEmployeeIds,['emp_001',backendEmployee.payload.data.id])
assert.equal(departmentParticipantsActivity.payload.data.participantCount,2)
assert.equal(departmentParticipantsActivity.payload.data.taskCount,2)

const departmentParticipantQuantityActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'部门参与者补充邀请码',teamId:'team_rd',participantMode:'quantity',participantCount:1,participantScope:'department',participantDepartmentId:'dep_rd',targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:['emp_002'],excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(departmentParticipantQuantityActivity.status,200)
const departmentParticipantSupplement = await call('/admin/verify-codes/generate',{
  method:'POST',cookie:adminCookie,body:{evaluationCodeId:departmentParticipantQuantityActivity.payload.data.activity.id,participantEmployeeIds:[backendEmployee.payload.data.id]}
})
assert.equal(departmentParticipantSupplement.status,200)
const teamLeaderParticipantSupplementDenied = await call('/admin/verify-codes/generate',{
  method:'POST',cookie:teamCookie,body:{evaluationCodeId:departmentParticipantQuantityActivity.payload.data.activity.id,participantEmployeeIds:[backendEmployee.payload.data.id]}
})
assert.equal(teamLeaderParticipantSupplementDenied.status,403)
const departmentParticipantOutOfScope = await call('/admin/verify-codes/generate',{
  method:'POST',cookie:adminCookie,body:{evaluationCodeId:departmentParticipantQuantityActivity.payload.data.activity.id,participantEmployeeIds:[inactiveBackendEmployee.payload.data.id]}
})
assert.equal(departmentParticipantOutOfScope.status,403)

const teamLeaderDepartmentParticipants = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:teamCookie,
  body:{name:'团队长部门参与者边界',teamId:'team_rd',participantMode:'selected',participantScope:'department',participantDepartmentId:'dep_rd',participantEmployeeIds:['emp_001',backendEmployee.payload.data.id],targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:['emp_002'],excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(teamLeaderDepartmentParticipants.status,200)
assert.deepEqual(teamLeaderDepartmentParticipants.payload.data.activity.participantEmployeeIds,['emp_001'])

const customScopeActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'自定义跨团队成员评价',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:['emp_002',backendEmployee.payload.data.id],excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(customScopeActivity.status,200)
assert.deepEqual(customScopeActivity.payload.data.activity.targetEmployeeIds,['emp_002',backendEmployee.payload.data.id])
assert.equal(customScopeActivity.payload.data.taskCount,2)

const includeSelfActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'允许自评测试',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:['emp_001',backendEmployee.payload.data.id],excludeSelf:false,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(includeSelfActivity.status,200)
assert.equal(includeSelfActivity.payload.data.taskCount,2)

const beforePeriodActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'周期前越界',teamId:'team_rd',participantMode:'quantity',participantCount:1,targetType:'employee',employeeTargetScope:'team',targetTeamId:'team_rd',periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:new Date(Date.now()-7_200_000).toISOString(),endTime:end}
})
assert.equal(beforePeriodActivity.status,400)
const afterPeriodActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'周期后越界',teamId:'team_rd',participantMode:'quantity',participantCount:1,targetType:'employee',employeeTargetScope:'team',targetTeamId:'team_rd',periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:new Date(Date.now()+3*86_400_000).toISOString()}
})
assert.equal(afterPeriodActivity.status,400)
const expiredPeriod = await call('/admin/periods',{
  method:'POST',cookie:adminCookie,
  body:{name:'已结束周期',startTime:new Date(Date.now()-3*86_400_000).toISOString(),endTime:new Date(Date.now()-2*86_400_000).toISOString(),status:'active'}
})
assert.equal(expiredPeriod.status,200)
const expiredPeriodActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{name:'已结束周期活动',teamId:'team_rd',participantMode:'quantity',participantCount:1,targetType:'employee',employeeTargetScope:'team',targetTeamId:'team_rd',periodMode:'existing',periodId:expiredPeriod.payload.data.id,startTime:new Date(Date.now()-3*86_400_000+1000).toISOString(),endTime:new Date(Date.now()-2*86_400_000-1000).toISOString()}
})
assert.equal(expiredPeriodActivity.status,400)
const scopedTargetDenied = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:teamCookie,
  body:{name:'越权目标成员',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:[backendEmployee.payload.data.id],excludeSelf:true,periodMode:'existing',periodId:boundedPeriod.payload.data.id,startTime:start,endTime:end}
})
assert.equal(scopedTargetDenied.status,400)

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

const teamActivity = await call('/admin/evaluation-activities/create-flow',{
  method:'POST',cookie:adminCookie,
  body:{
    name:'团队整体评分测试',teamId:'team_rd',participantMode:'selected',participantEmployeeIds:['emp_001'],
    targetType:'team',targetMode:'selected',targetTeamIds:['team_rd','team_pm'],
    startTime:start,endTime:end
  }
})
assert.equal(teamActivity.status,200)
assert.equal(teamActivity.payload.data.activity.targetType,'team')
assert.equal(teamActivity.payload.data.targetCount,2)
assert.equal(teamActivity.payload.data.taskCount,2)
const teamEntry = await call('/public/verify-entry',{
  method:'POST',body:{evaluationCode:teamActivity.payload.data.activity.linkCode,verifyCode:teamActivity.payload.data.verifyCodes[0].code}
})
assert.equal(teamEntry.status,200)
let teamRemaining = 2
while (teamRemaining > 0) {
  const teamTask = await call('/public/current-task',{token:teamEntry.payload.token})
  assert.equal(teamTask.status,200)
  assert.equal(teamTask.payload.data.targetType,'team')
  assert.equal(teamTask.payload.data.target.targetType,'team')
  assert.ok(['team_rd','team_pm'].includes(teamTask.payload.data.target.id))
  const teamSubmit = await call('/public/submit-score',{
    method:'POST',token:teamEntry.payload.token,
    body:{taskId:teamTask.payload.data.id,scores:{ability:91,attitude:89,collaboration:90}}
  })
  assert.equal(teamSubmit.status,200)
  teamRemaining = teamSubmit.payload.data.remaining
}
const teamResults = await call(`/admin/results?evaluationCodeId=${teamActivity.payload.data.activity.id}`,{cookie:adminCookie})
assert.equal(teamResults.status,200)
assert.equal(teamResults.payload.data.targetType,'team')
assert.equal(teamResults.payload.data.items.length,2)
assert.ok(teamResults.payload.data.items.every((item) => item.targetType === 'team' && item.reviewCount === 1))
const singleTeamTrend = await call('/admin/trends?targetType=team&targetId=team_pm',{cookie:adminCookie})
assert.equal(singleTeamTrend.status,200)
assert.equal(singleTeamTrend.payload.data.points.length,1)
const emptyTrendTeam = await call('/admin/teams',{method:'POST',cookie:adminCookie,body:{name:'空趋势团队',departmentId:'dep_rd',leader:'',sort:9,status:'active'}})
assert.equal(emptyTrendTeam.status,200)
const noTeamTrend = await call(`/admin/trends?targetType=team&targetId=${encodeURIComponent(emptyTrendTeam.payload.data.id)}`,{cookie:adminCookie})
assert.deepEqual(noTeamTrend.payload.data.points,[])

async function createTrendActivity({name,targetType,targetId,totals,endOffsetDays}) {
  const trendNow = Date.now()
  const body = targetType === 'team'
    ? {name,teamId:'team_rd',participantMode:'quantity',participantCount:2,targetType:'team',targetMode:'selected',targetTeamIds:[targetId],startTime:new Date(trendNow-60_000).toISOString(),endTime:new Date(trendNow+endOffsetDays*86_400_000).toISOString()}
    : {name,teamId:'team_rd',participantMode:'quantity',participantCount:2,targetType:'employee',employeeTargetScope:'custom',targetEmployeeIds:[targetId],excludeSelf:true,startTime:new Date(trendNow-60_000).toISOString(),endTime:new Date(trendNow+endOffsetDays*86_400_000).toISOString()}
  const activity = await call('/admin/evaluation-activities/create-flow',{method:'POST',cookie:adminCookie,body})
  assert.equal(activity.status,200)
  for (const [index,verify] of activity.payload.data.verifyCodes.entries()) {
    const entry = await call('/public/verify-entry',{method:'POST',body:{evaluationCode:activity.payload.data.activity.linkCode,verifyCode:verify.code}})
    assert.equal(entry.status,200)
    const task = await call('/public/current-task',{token:entry.payload.token})
    assert.equal(task.status,200)
    const score = totals[index]
    const submitted = await call('/public/submit-score',{method:'POST',token:entry.payload.token,body:{taskId:task.payload.data.id,scores:{ability:score,attitude:score,collaboration:score}}})
    assert.equal(submitted.status,200)
  }
  return activity.payload.data.activity
}

const employeeTrendFirst = await createTrendActivity({name:'员工趋势第一期',targetType:'employee',targetId:'emp_004',totals:[80,90],endOffsetDays:5})
const employeeTrendEnded = await call(`/admin/evaluation-codes/${employeeTrendFirst.id}`,{method:'PUT',cookie:adminCookie,body:{endTime:new Date(Date.now()-1_000).toISOString()}})
assert.equal(employeeTrendEnded.status,200)
const employeeTrendArchived = await call(`/admin/evaluation-codes/${employeeTrendFirst.id}`,{method:'PUT',cookie:adminCookie,body:{status:'archived'}})
assert.equal(employeeTrendArchived.status,200)
const singleEmployeeTrend = await call('/admin/trends?targetType=employee&targetId=emp_004',{cookie:adminCookie})
assert.deepEqual(singleEmployeeTrend.payload.data.points.map((point) => point.total),[85])
const employeeTrendSecond = await createTrendActivity({name:'员工趋势第二期',targetType:'employee',targetId:'emp_004',totals:[91,99],endOffsetDays:6})
const employeeTrend = await call('/admin/trends?targetType=employee&targetId=emp_004',{cookie:adminCookie})
assert.equal(employeeTrend.status,200)
assert.deepEqual(employeeTrend.payload.data.points.map((point) => point.total),[85,95])
assert.equal(employeeTrend.payload.data.points[0].archived,true)
const employeeTrendRange = await call(`/admin/trends?targetType=employee&targetId=emp_004&startTime=${encodeURIComponent(employeeTrendSecond.endTime)}`,{cookie:adminCookie})
assert.equal(employeeTrendRange.status,200)
assert.deepEqual(employeeTrendRange.payload.data.points.map((point) => point.total),[95])
const noEmployeeTrend = await call('/admin/trends?targetType=employee&targetId=emp_005',{cookie:adminCookie})
assert.equal(noEmployeeTrend.status,200)
assert.deepEqual(noEmployeeTrend.payload.data.points,[])

const teamTrendFirst = await createTrendActivity({name:'团队趋势第一期',targetType:'team',targetId:backendTeam.payload.data.id,totals:[80,90],endOffsetDays:5})
const teamTrendEnded = await call(`/admin/evaluation-codes/${teamTrendFirst.id}`,{method:'PUT',cookie:adminCookie,body:{endTime:new Date(Date.now()-1_000).toISOString()}})
assert.equal(teamTrendEnded.status,200)
const teamTrendArchived = await call(`/admin/evaluation-codes/${teamTrendFirst.id}`,{method:'PUT',cookie:adminCookie,body:{status:'archived'}})
assert.equal(teamTrendArchived.status,200)
await createTrendActivity({name:'团队趋势第二期',targetType:'team',targetId:backendTeam.payload.data.id,totals:[91,99],endOffsetDays:6})
const teamTrend = await call(`/admin/trends?targetType=team&targetId=${encodeURIComponent(backendTeam.payload.data.id)}`,{cookie:adminCookie})
assert.equal(teamTrend.status,200)
assert.deepEqual(teamTrend.payload.data.points.map((point) => point.total),[85,95])
assert.ok(teamTrend.payload.data.points.every((point) => typeof point.reviewCount === 'number'))
const trendOptions = await call('/admin/trends/options',{cookie:adminCookie})
assert.equal(trendOptions.status,200)
assert.ok(trendOptions.payload.data.employees.some((employee) => employee.id === 'emp_004'))
assert.ok(trendOptions.payload.data.teams.some((team) => team.id === backendTeam.payload.data.id))
const scopedTrendDenied = await call(`/admin/trends?targetType=team&targetId=${encodeURIComponent(backendTeam.payload.data.id)}`,{cookie:teamCookie})
assert.equal(scopedTrendDenied.status,403)
const memberTrendDenied = await call('/admin/trends?targetType=employee&targetId=emp_004',{cookie:memberCookie})
assert.equal(memberTrendDenied.status,403)

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
const unusedTimedRows = await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
const unusedTimedRow = unusedTimedRows.payload.data.items.find((item) => item.id === timed.payload.data.id)
assert.equal(unusedTimedRow.status,'unused')
assert.equal(unusedTimedRow.completedTasks,0)
assert.equal(unusedTimedRow.totalTasks,timed.payload.data.taskCount)
const timedEntry = await call('/public/timed-entry',{method:'POST',body:{linkCode:timed.payload.data.linkCode}})
assert.equal(timedEntry.status,200)
assert.ok(timedEntry.payload.expiresAt)
let timedRemaining = timedEntry.payload.remaining
let checkedPartialTimedProgress = false
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
  if (!checkedPartialTimedProgress && timedRemaining > 0) {
    const partialTimedRows = await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
    const partialTimedRow = partialTimedRows.payload.data.items.find((item) => item.id === timed.payload.data.id)
    assert.equal(partialTimedRow.status,'in_progress')
    assert.equal(partialTimedRow.completedTasks,1)
    assert.equal(partialTimedRow.remainingTasks,partialTimedRow.totalTasks-1)
    checkedPartialTimedProgress = true
  }
}
assert.ok(checkedPartialTimedProgress)
const completedTimedRows = await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
const completedTimedRow = completedTimedRows.payload.data.items.find((item) => item.id === timed.payload.data.id)
assert.equal(completedTimedRow.status,'completed')
assert.equal(completedTimedRow.completedTasks,completedTimedRow.totalTasks)
assert.equal(completedTimedRow.remainingTasks,0)
const timedReuse = await call('/public/timed-entry',{method:'POST',body:{linkCode:timed.payload.data.linkCode}})
assert.equal(timedReuse.status,404)

const expiringTimed = await call('/admin/timed-invites/generate',{
  method:'POST',cookie:adminCookie,body:{evaluationCodeId:created.payload.data.activity.id}
})
assert.equal(expiringTimed.status,200)
env.TIMED_INVITE_SECONDS = '1'
const expiringEntry = await call('/public/timed-entry',{method:'POST',body:{linkCode:expiringTimed.payload.data.linkCode}})
assert.equal(expiringEntry.status,200)
const expiresAtMs = new Date(expiringEntry.payload.expiresAt).getTime()
assert.ok(expiresAtMs > Date.now())
assert.ok(expiresAtMs <= Date.now()+2_000)
env.TIMED_INVITE_SECONDS = '300'
let expiredTimedRow
for (let attempt = 0; attempt < 12; attempt++) {
  const expiredTimedRows = await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
  expiredTimedRow = expiredTimedRows.payload.data.items.find((item) => item.id === expiringTimed.payload.data.id)
  if (expiredTimedRow?.status === 'expired') break
  await new Promise((resolve) => setTimeout(resolve,250))
}
assert.equal(expiredTimedRow.status,'expired')
assert.equal(expiredTimedRow.completedTasks,0)
assert.equal(expiredTimedRow.remainingTasks,expiredTimedRow.totalTasks)

const archiveBaseline = {
  results:await call(`/admin/results?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  tasks:await call(`/admin/tasks?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  verifies:await call(`/admin/verify-codes?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  timed:await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
}
const prematureArchive = await call(`/admin/evaluation-codes/${created.payload.data.activity.id}`,{
  method:'PUT',cookie:adminCookie,body:{status:'archived'}
})
assert.equal(prematureArchive.status,409)
const endActivity = await call(`/admin/evaluation-codes/${created.payload.data.activity.id}`,{
  method:'PUT',cookie:adminCookie,body:{endTime:new Date(Date.now()-1_000).toISOString()}
})
assert.equal(endActivity.status,200)
assert.equal(endActivity.payload.data.status,'ended')
const archivedActivity = await call(`/admin/evaluation-codes/${created.payload.data.activity.id}`,{
  method:'PUT',cookie:adminCookie,body:{status:'archived'}
})
assert.equal(archivedActivity.status,200)
assert.equal(archivedActivity.payload.data.status,'archived')
const archivedList = await call('/admin/evaluation-codes',{cookie:adminCookie})
assert.equal(archivedList.payload.data.items.find((item) => item.id === created.payload.data.activity.id).status,'archived')
const archivedSnapshot = {
  results:await call(`/admin/results?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  tasks:await call(`/admin/tasks?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  verifies:await call(`/admin/verify-codes?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie}),
  timed:await call(`/admin/timed-invites?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
}
assert.deepEqual(archivedSnapshot.results.payload.data.items,archiveBaseline.results.payload.data.items)
assert.equal(archivedSnapshot.tasks.payload.data.items.length,archiveBaseline.tasks.payload.data.items.length)
assert.equal(archivedSnapshot.verifies.payload.data.items.length,archiveBaseline.verifies.payload.data.items.length)
assert.equal(archivedSnapshot.timed.payload.data.items.length,archiveBaseline.timed.payload.data.items.length)
const archivedGenerate = await call('/admin/verify-codes/generate',{
  method:'POST',cookie:adminCookie,body:{evaluationCodeId:created.payload.data.activity.id,count:1}
})
assert.equal(archivedGenerate.status,409)
const archivedTaskSync = await call('/admin/tasks/generate',{
  method:'POST',cookie:adminCookie,body:{evaluationCodeId:created.payload.data.activity.id}
})
assert.equal(archivedTaskSync.status,409)
const archivedRules = await call('/admin/settings/score-rules',{method:'GET',cookie:adminCookie})
const archivedRuleWrite = await call('/admin/settings/score-rules',{
  method:'PUT',cookie:adminCookie,body:{evaluationCodeId:created.payload.data.activity.id,rules:archivedRules.payload.data.rules,rounding:archivedRules.payload.data.rounding}
})
assert.equal(archivedRuleWrite.status,409)
const archivedUnused = archivedSnapshot.verifies.payload.data.items.find((item) => item.status === 'unused')
assert.ok(archivedUnused)
const archivedDeleteVerify = await call(`/admin/verify-codes/${archivedUnused.id}`,{method:'DELETE',cookie:adminCookie})
assert.equal(archivedDeleteVerify.status,409)
const restoredActivity = await call(`/admin/evaluation-codes/${created.payload.data.activity.id}`,{
  method:'PUT',cookie:adminCookie,body:{status:'active'}
})
assert.equal(restoredActivity.status,200)
assert.equal(restoredActivity.payload.data.status,'ended')
const restoredResults = await call(`/admin/results?evaluationCodeId=${created.payload.data.activity.id}`,{cookie:adminCookie})
assert.deepEqual(restoredResults.payload.data.items,archiveBaseline.results.payload.data.items)

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
assert.ok(logs.payload.data.items.some((item) => item.action === 'evaluation.archive'))
assert.ok(logs.payload.data.items.some((item) => item.action === 'evaluation.unarchive'))
const badImport = await call('/admin/import/json',{method:'POST',cookie:adminCookie,body:{data:{employees:[]}}})
assert.equal(badImport.status,400)
assert.match(badImport.payload.message,/缺少|结构无效/)

const logout = await call('/admin/logout',{method:'POST',cookie:adminCookie})
assert.equal(logout.status,200)
assert.ok(logout.cookie.startsWith('lumirror_admin='))

console.log('API smoke test passed: auth/RBAC, periods, custom add/subtract score rules, dynamic results, invitations, strict validation, batch ops, exports, maintenance and import validation')
