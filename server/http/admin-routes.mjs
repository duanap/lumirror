import { AppError } from './errors.mjs'
import { ok, jsonResponse } from './responses.mjs'
import { dateFields, integerQuery } from './validation.mjs'
import { signToken, adminCookie } from '../security/tokens.mjs'
import { userView } from '../security/permissions.mjs'
import { rateKey } from '../security/rate-limit.mjs'
import { activityStatus } from '../domain/activity.mjs'
import { prepareScoreRules } from '../domain/score-rules.mjs'
import { ROUNDING_MODES } from '../../shared/scoring.mjs'

const query = (ctx,key) => ctx.url.searchParams.get(key) || ''
function cookieFor(user,env) {
  const seconds = Number(env.ADMIN_SESSION_SECONDS || 28800)
  const token = signToken({kind:'backend',userId:user.id,username:user.username,role:user.role,authVersion:Number(user.authVersion || 0)},env.ADMIN_TOKEN_SECRET,seconds)
  return {'set-cookie':adminCookie(token,seconds,env.SESSION_COOKIE_SECURE !== 'false')}
}
function pagination(ctx) {
  return {limit:integerQuery(ctx.url.searchParams.get('limit'),undefined,1,200),offset:integerQuery(ctx.url.searchParams.get('offset'),0,0,1000000)}
}
function activityInput(ctx) {
  const input = dateFields(ctx.input)
  if (input.rules !== undefined) input.rules = prepareScoreRules(input.rules)
  if (input.rounding !== undefined && !ROUNDING_MODES.includes(input.rounding)) throw new AppError('评分取整方式无效')
  return input
}
const route = (method,path,permission,handler,extra = {}) => ({method,path,permission,handler,...extra})

export const adminRoutes = [
  route('POST','/admin/login',null,async (ctx) => {
    const username = String(ctx.input.username || '').trim()
    const limiter = ctx.env.RATE_LIMITER
    const account = rateKey(ctx.env.ADMIN_TOKEN_SECRET,'login-failure',ctx.clientAddress,username.toLowerCase())
    limiter.take(rateKey(ctx.env.ADMIN_TOKEN_SECRET,'login-traffic',ctx.clientAddress),80,300000)
    limiter.check(account,10)
    const user = await ctx.env.USER_REPOSITORY.login(username,ctx.input.password)
    if (!user) { limiter.take(account,10,300000); throw new AppError('账号或密码错误',401,'INVALID_CREDENTIALS') }
    limiter.forget(account)
    return jsonResponse({success:true,user:userView(user)},200,cookieFor(user,ctx.env))
  }),
  route('GET','/admin/me','authenticated',(ctx) => ok(userView(ctx.env.USER_REPOSITORY.findUser(ctx.actor.userId))),{allowInitial:true}),
  route('POST','/admin/logout','authenticated',(ctx) => ok({loggedOut:true},{'set-cookie':adminCookie('',0,ctx.env.SESSION_COOKIE_SECURE !== 'false')}),{allowInitial:true}),
  route('POST','/admin/logout-all','authenticated',(ctx) => ok(ctx.env.USER_REPOSITORY.revokeSessions(ctx.actor.userId),{'set-cookie':adminCookie('',0,ctx.env.SESSION_COOKIE_SECURE !== 'false')}),{allowInitial:true}),
  route('POST','/admin/change-password','authenticated',async (ctx) => {
    if (ctx.input.confirmPassword !== undefined && ctx.input.confirmPassword !== ctx.input.newPassword) throw new AppError('两次输入的新密码不一致')
    ctx.env.RATE_LIMITER.take(rateKey(ctx.env.ADMIN_TOKEN_SECRET,'password-change',ctx.actor.userId),10,300000)
    const result = await ctx.env.USER_REPOSITORY.changePassword(ctx.actor.userId,ctx.input.currentPassword,ctx.input.newPassword)
    return ok(result,cookieFor(ctx.env.USER_REPOSITORY.findUser(ctx.actor.userId),ctx.env))
  },{allowInitial:true}),
  route('GET','/admin/dashboard','dashboard:view',(ctx) => ok(ctx.env.QUERY_REPOSITORY.dashboard(ctx.actor,query(ctx,'evaluationCodeId')))),
  route('GET','/admin/evaluation-options','activities:view',(ctx) => ok(ctx.env.QUERY_REPOSITORY.evaluationOptions(ctx.actor))),
  route('GET','/admin/employees','employees:view',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.list(ctx.actor,{q:query(ctx,'q'),teamId:query(ctx,'teamId'),departmentId:query(ctx,'departmentId'),status:query(ctx,'status'),...pagination(ctx)}))),
  route('POST','/admin/employees','employees:write',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.create(ctx.input,ctx.actor))),
  route('PUT','/admin/employees/:id','employees:write',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.update(ctx.params.id,ctx.input,ctx.actor))),
  route('DELETE','/admin/employees/:id','employees:write',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.delete(ctx.params.id,ctx.actor))),
  route('GET','/admin/member-tags','employees:view',(ctx) => ok({items:ctx.env.EMPLOYEE_REPOSITORY.listTags(ctx.actor),canCreate:['admin','team_leader'].includes(ctx.actor.role),canManage:ctx.actor.role === 'admin'})),
  route('POST','/admin/member-tags','employees:write',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.createTag(ctx.input,ctx.actor))),
  route('PUT','/admin/member-tags/:id','admin',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.updateTag(ctx.params.id,ctx.input,ctx.actor))),
  route('DELETE','/admin/member-tags/:id','admin',(ctx) => ok(ctx.env.EMPLOYEE_REPOSITORY.deleteTag(ctx.params.id,ctx.actor))),
  ...['departments','teams'].flatMap((kind) => [
    route('GET',`/admin/${kind}`,'employees:view',(ctx) => ok(ctx.env.ORGANIZATION_REPOSITORY.list(kind,ctx.actor))),
    route('POST',`/admin/${kind}`,'admin',(ctx) => ok(ctx.env.ORGANIZATION_REPOSITORY.create(kind,ctx.input,ctx.actor))),
    route('PUT',`/admin/${kind}/:id`,'admin',(ctx) => ok(ctx.env.ORGANIZATION_REPOSITORY.update(kind,ctx.params.id,ctx.input,ctx.actor))),
    route('DELETE',`/admin/${kind}/:id`,'admin',(ctx) => ok(ctx.env.ORGANIZATION_REPOSITORY.delete(kind,ctx.params.id,ctx.actor)))
  ]),
  route('GET','/admin/periods','periods:view',(ctx) => ok({items:ctx.env.PERIOD_REPOSITORY.list(),canWrite:ctx.actor.role === 'admin'})),
  route('POST','/admin/periods','admin',(ctx) => ok(ctx.env.PERIOD_REPOSITORY.create(dateFields(ctx.input)))),
  route('PUT','/admin/periods/:id','admin',(ctx) => ok(ctx.env.PERIOD_REPOSITORY.update(ctx.params.id,dateFields(ctx.input)))),
  route('DELETE','/admin/periods/:id','admin',(ctx) => ok(ctx.env.PERIOD_REPOSITORY.delete(ctx.params.id))),
  route('GET','/admin/users','admin',(ctx) => ok(ctx.env.USER_REPOSITORY.list())),
  route('POST','/admin/users','admin',async (ctx) => ok(await ctx.env.USER_REPOSITORY.create(ctx.input))),
  route('PUT','/admin/users/:id','admin',async (ctx) => ok(await ctx.env.USER_REPOSITORY.update(ctx.params.id,ctx.input))),
  route('DELETE','/admin/users/:id','admin',(ctx) => ok(ctx.env.USER_REPOSITORY.delete(ctx.params.id,ctx.actor.userId))),
  route('GET','/admin/evaluation-codes','activities:view',(ctx) => ok(ctx.env.SCORE_REPOSITORY.listActivities(ctx.actor))),
  route('POST','/admin/evaluation-activities/create-flow','activities:write',(ctx) => ok(ctx.env.EVALUATION_REPOSITORY.createActivity(activityInput(ctx),ctx.actor))),
  route('PUT','/admin/evaluation-codes/:id','activities:write',(ctx) => ok(ctx.env.EVALUATION_REPOSITORY.update(ctx.params.id,activityInput(ctx),ctx.actor))),
  route('DELETE','/admin/evaluation-codes/:id','activities:write',(ctx) => ok(ctx.env.EVALUATION_REPOSITORY.delete(ctx.params.id,ctx.actor))),
  route('GET','/admin/verify-codes','verify:view',(ctx) => ok(ctx.env.TASK_REPOSITORY.listVerifyCodes(ctx.actor,query(ctx,'evaluationCodeId')))),
  route('POST','/admin/verify-codes/generate','verify:write',(ctx) => ok(ctx.env.TASK_REPOSITORY.generateVerifyCodes(ctx.input.evaluationCodeId,ctx.actor,ctx.input))),
  route('DELETE','/admin/verify-codes/:id','verify:write',(ctx) => ok(ctx.env.TASK_REPOSITORY.deleteVerifyCode(ctx.params.id,ctx.actor))),
  route('GET','/admin/timed-invites','verify:view',(ctx) => ok(ctx.env.TASK_REPOSITORY.listTimedInvites(ctx.actor,query(ctx,'evaluationCodeId')))),
  route('POST','/admin/timed-invites/generate','verify:write',(ctx) => ok(ctx.env.TASK_REPOSITORY.generateTimedInvite(ctx.input.evaluationCodeId,ctx.actor))),
  route('GET','/admin/tasks','tasks:view',(ctx) => ok(ctx.env.TASK_REPOSITORY.listAdminTasks(ctx.actor,query(ctx,'evaluationCodeId')))),
  route('POST','/admin/tasks/generate','tasks:write',(ctx) => ok(ctx.env.TASK_REPOSITORY.generateTasks(ctx.input.evaluationCodeId,ctx.actor))),
  route('DELETE','/admin/tasks/:id','tasks:write',(ctx) => ok(ctx.env.TASK_REPOSITORY.deleteTask(ctx.params.id,ctx.actor))),
  route('GET','/admin/results','results:view',(ctx) => {
    const result = ctx.env.SCORE_REPOSITORY.listResults(ctx.actor,query(ctx,'evaluationCodeId'))
    if (result.activity) result.activity = {...result.activity,status:activityStatus(result.activity),lifecycleStatus:result.activity.status}
    return ok(result)
  }),
  route('GET','/admin/trends/options','results:view',(ctx) => ok(ctx.env.SCORE_REPOSITORY.listTrendOptions(ctx.actor))),
  route('GET','/admin/trends','results:view',(ctx) => {
    const targetType = query(ctx,'targetType') === 'team' ? 'team' : 'employee'
    const targetId = query(ctx,'targetId')
    if (!targetId) return ok({targetType,target:null,points:[]})
    const startTime = query(ctx,'startTime'), endTime = query(ctx,'endTime')
    if ((startTime && !Number.isFinite(Date.parse(startTime))) || (endTime && !Number.isFinite(Date.parse(endTime))) || (startTime && endTime && Date.parse(startTime)>Date.parse(endTime))) throw new AppError('趋势时间范围无效')
    const result = ctx.env.SCORE_REPOSITORY.listTrends(ctx.actor,{targetType,targetId,startTime,endTime})
    if (!result) throw new AppError('评价对象不存在或无权查看',403,'FORBIDDEN')
    return ok({...result,points:result.points.map((point) => ({...point,status:activityStatus(point)}))})
  }),
  route('GET','/admin/settings','authenticated',(ctx) => ok({...ctx.env.SETTINGS_REPOSITORY.get(),canEdit:ctx.actor.role === 'admin'}),{allowInitial:true}),
  route('PUT','/admin/settings','admin',(ctx) => ok(ctx.env.SETTINGS_REPOSITORY.update(ctx.input))),
  route('GET','/admin/settings/score-rules','score-rules',(ctx) => ok(ctx.env.SETTINGS_REPOSITORY.scoreRules(query(ctx,'evaluationCodeId'),ctx.actor))),
  route('PUT','/admin/settings/score-rules','score-rules',(ctx) => ok(ctx.env.SETTINGS_REPOSITORY.updateScoreRules(ctx.input.evaluationCodeId,ctx.input,ctx.actor))),
  route('GET','/admin/deployment-check','admin',(ctx) => ok(ctx.env.QUERY_REPOSITORY.deploymentCheck(ctx.env))),
  route('GET','/admin/logs','admin',(ctx) => ok(ctx.env.AUDIT_REPOSITORY.list(ctx.actor,{...Object.fromEntries(ctx.url.searchParams),...pagination(ctx)}))),
  route('POST','/admin/batch','authenticated',(ctx) => ok(ctx.env.BATCH_REPOSITORY.run(ctx.actor,ctx.input))),
  route('POST','/admin/maintenance/cleanup','admin',(ctx) => ok(ctx.env.MAINTENANCE_REPOSITORY.cleanup(ctx.actor))),
  route('GET','/admin/export/json','admin',async (ctx) => ok(await ctx.env.MAINTENANCE_REPOSITORY.exportSanitized())),
  route('POST','/admin/export/full-json','admin',async (ctx) => {
    if (ctx.input.confirm !== 'EXPORT_FULL_BACKUP') throw new AppError('完整备份包含敏感数据，请先确认',400,'CONFIRM_REQUIRED')
    return ok(await ctx.env.MAINTENANCE_REPOSITORY.exportFull(ctx.actor))
  }),
  route('POST','/admin/import/preflight','admin',(ctx) => ok(ctx.env.MAINTENANCE_REPOSITORY.preflight(ctx.input.data))),
  route('POST','/admin/import/json','admin',async (ctx) => {
    if (ctx.input.confirm !== 'IMPORT_REPLACE_DATA' || !ctx.input.previewHash || !ctx.input.revision) throw new AppError('请先预检并确认覆盖当前业务数据',400,'CONFIRM_REQUIRED')
    const result = await ctx.env.MAINTENANCE_REPOSITORY.importData(ctx.input.data,ctx.actor,{previewHash:ctx.input.previewHash,revision:ctx.input.revision})
    return ok(result,cookieFor(ctx.env.USER_REPOSITORY.findUser(ctx.actor.userId),ctx.env))
  })
]
