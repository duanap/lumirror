import { createHash } from 'node:crypto'
import { AppError } from './errors.mjs'
import { jsonResponse, ok } from './responses.mjs'
import { publicSession, publicAuthVersion, signToken } from '../security/tokens.mjs'
import { rateKey } from '../security/rate-limit.mjs'
import { activityStatus } from '../domain/activity.mjs'

const deny = (message,status = 403,code = 'FORBIDDEN') => { throw new AppError(message,status,code) }
const unavailable = () => deny('评价不存在或已结束',404,'NOT_FOUND')
function rate(ctx,bucket,limit,windowMs = 300000) {
  ctx.env.RATE_LIMITER.take(rateKey(ctx.env.PUBLIC_TOKEN_SECRET,bucket,ctx.clientAddress || 'local'),limit,windowMs)
}
function assertSession(ctx) {
  const session = publicSession(ctx.request,ctx.env)
  if (!session) deny('评价会话已失效，请重新进入',401,'SESSION_EXPIRED')
  const verify = ctx.env.EVALUATION_KV.database.prepare('SELECT v.status,v.payload_json,e.status AS evaluation_status,e.start_time,e.end_time FROM verification_codes v JOIN evaluation_activities e ON e.id=v.evaluation_id WHERE v.id=? AND v.evaluation_id=?').get(session.verifyCodeId,session.evaluationCodeId)
  if (!verify) unavailable()
  if (JSON.parse(verify.payload_json).evaluatorHash !== session.evaluatorHash) deny('评价会话已撤销',401,'SESSION_EXPIRED')
  if (activityStatus({...verify,status:verify.evaluation_status}) !== 'active') deny('评价活动当前不可用',403,'ACTIVITY_UNAVAILABLE')
  if (['locked','disabled'].includes(verify.status)) deny('邀请码已停用',403,'INVITE_DISABLED')
  return session
}
function assertUsable(result,session) {
  if (session.timedInviteId && !result?.timedInvite) deny('时效链接不可用',403,'EXPIRED')
  if (!result) unavailable()
  if (result.evaluation && activityStatus(result.evaluation) !== 'active') deny('评价活动尚未开始、已停用或已结束',403,'ACTIVITY_UNAVAILABLE')
  if (result.timedInvite?.status === 'completed' && result.remaining === 0) return
  if (result.timedInvite && (['completed','expired'].includes(result.timedInvite.status) || result.timedInvite.expiresAt && Date.parse(result.timedInvite.expiresAt) <= Date.now())) deny('时效链接已结束',403,'EXPIRED')
}
function failureKeys(ctx,linkCode) {
  return [rateKey(ctx.env.PUBLIC_TOKEN_SECRET,'entry-failure',ctx.clientAddress,linkCode),rateKey(ctx.env.PUBLIC_TOKEN_SECRET,'all-entry-failures',ctx.clientAddress)]
}
function checkFailures(ctx,keys) { ctx.env.RATE_LIMITER.check(keys[0],30); ctx.env.RATE_LIMITER.check(keys[1],120) }
function recordFailure(ctx,keys) { ctx.env.RATE_LIMITER.take(keys[0],30,300000); ctx.env.RATE_LIMITER.take(keys[1],120,300000) }

export const publicRoutes = [
  {method:'POST',path:'/public/evaluation-title',handler:(ctx) => {
    rate(ctx,'title',300,60000)
    const result = ctx.env.TASK_REPOSITORY.findEvaluationTitle(String(ctx.input.linkCode || '').trim())
    if (!result) unavailable()
    return ok(result)
  }},
  {method:'POST',path:'/public/verify-entry',handler:(ctx) => {
    rate(ctx,'entry-traffic',600)
    const linkCode = String(ctx.input.evaluationCode || '').trim()
    const verifyCode = String(ctx.input.verifyCode || '').trim()
    const keys = failureKeys(ctx,linkCode)
    checkFailures(ctx,keys)
    if (!linkCode || !/^\d{6}$/.test(verifyCode)) { recordFailure(ctx,keys); deny('请输入有效邀请链接和 6 位邀请码',400,'INVALID_INVITE') }
    const evaluation = ctx.env.EVALUATION_KV.database.prepare('SELECT id FROM evaluation_activities WHERE link_code=?').get(linkCode)
    if (evaluation) {
      const hash = createHash('sha256').update(`${evaluation.id}:${verifyCode}`).digest('hex')
      const verify = ctx.env.EVALUATION_KV.database.prepare('SELECT status FROM verification_codes WHERE evaluation_id=? AND code_hash=?').get(evaluation.id,hash)
      if (verify && ['locked','disabled'].includes(verify.status)) deny('邀请码已停用',403,'INVITE_DISABLED')
    }
    const result = ctx.env.TASK_REPOSITORY.openVerifyEntry({linkCode,verifyCode})
    if (!result) { recordFailure(ctx,keys); deny('邀请码无效或与链接不匹配',403,'INVALID_INVITE') }
    if (result.kind === 'ended') deny('评价活动已结束',403,'ACTIVITY_UNAVAILABLE')
    if (result.kind === 'no-tasks') deny('当前邀请码没有评价任务',409,'NO_TASKS')
    if (result.kind === 'completed') deny('已完成全部评价',403,'COMPLETED')
    const token = signToken({role:'evaluator',publicVersion:publicAuthVersion(ctx.env),evaluationCodeId:result.evaluationId,verifyCodeId:result.verifyId,evaluatorHash:result.evaluatorHash},ctx.env.PUBLIC_TOKEN_SECRET,ctx.env.TASK_REPOSITORY.getPublicSessionSeconds(7200))
    return jsonResponse({success:true,token,evaluation:{id:result.evaluationId,name:result.evaluationName,teamName:result.teamName},remaining:result.remaining})
  }},
  {method:'POST',path:'/public/timed-entry',handler:(ctx) => {
    rate(ctx,'entry-traffic',600)
    const linkCode = String(ctx.input.linkCode || '').trim()
    const keys = failureKeys(ctx,linkCode)
    checkFailures(ctx,keys)
    const verification = ctx.env.EVALUATION_KV.database.prepare('SELECT v.status FROM verification_codes v JOIN timed_invites i ON i.verification_code_id=v.id WHERE i.link_code=?').get(linkCode)
    if (verification && ['locked','disabled'].includes(verification.status)) deny('邀请码已停用',403,'INVITE_DISABLED')
    const result = ctx.env.TASK_REPOSITORY.openTimedInvite({linkCode,lifetimeSeconds:Number(ctx.env.TIMED_INVITE_SECONDS || 300)})
    if (result.kind === 'not-found') { recordFailure(ctx,keys); unavailable() }
    if (['ended','completed','expired'].includes(result.kind)) deny('评价不存在或已结束',403,result.kind.toUpperCase())
    const token = signToken({role:'evaluator',publicVersion:publicAuthVersion(ctx.env),evaluationCodeId:result.evaluation.id,verifyCodeId:result.verifyId,evaluatorHash:result.evaluatorHash,timedInviteId:result.inviteId},ctx.env.PUBLIC_TOKEN_SECRET,Math.max(1,Math.floor(result.expiresIn)))
    return jsonResponse({success:true,token,timed:true,expiresAt:result.expiresAt,evaluation:{id:result.evaluation.id,name:result.evaluation.name,teamName:result.evaluation.teamName},remaining:result.remaining})
  }},
  {method:'GET',path:'/public/current-task',handler:(ctx) => {
    const session = assertSession(ctx)
    const result = ctx.env.TASK_REPOSITORY.findCurrentTask({evaluationId:session.evaluationCodeId,verifyId:session.verifyCodeId,timedInviteId:session.timedInviteId || ''})
    assertUsable(result,session)
    if (!result.task) deny(result.remaining === 0 ? '已完成全部评价' : '没有待评价任务',404,result.remaining === 0 ? 'COMPLETED' : 'NO_TASKS')
    return ok({id:result.task.id,target:result.task.target,targetType:result.task.targetType,evaluation:{id:result.evaluation.id,name:result.evaluation.name,teamName:result.evaluation.teamName},rules:result.rules,rounding:result.evaluation.rounding || 'one_decimal',remaining:result.remaining,timed:Boolean(result.timedInvite),expiresAt:result.timedInvite?.expiresAt || null})
  }},
  {method:'GET',path:'/public/remaining',handler:(ctx) => {
    const session = assertSession(ctx)
    const result = ctx.env.TASK_REPOSITORY.findProgress({evaluationId:session.evaluationCodeId,verifyId:session.verifyCodeId,timedInviteId:session.timedInviteId || ''})
    assertUsable(result,session)
    return ok({remaining:result.remaining,completed:result.remaining === 0,timed:Boolean(result.timedInvite),expiresAt:result.timedInvite?.expiresAt || null})
  }},
  {method:'POST',path:'/public/submit-score',handler:(ctx) => ok(ctx.env.PUBLIC_SCORE_REPOSITORY.submit(assertSession(ctx),ctx.input))},
  {method:'POST',path:'/public/logout',handler:() => ok({loggedOut:true})}
]
