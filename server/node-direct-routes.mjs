import { adminRoutes } from './http/admin-routes.mjs'
import { publicRoutes } from './http/public-routes.mjs'
import { AppError } from './http/errors.mjs'
import { bodyJson } from './http/validation.mjs'
import { assertOrigin, jsonResponse, JSON_HEADERS } from './http/responses.mjs'
import { resolveAdminActor } from './security/tokens.mjs'
import { can } from './security/permissions.mjs'
import { runWithAuditActor } from './request-context.mjs'

export const NODE_ROUTES = [...adminRoutes,...publicRoutes].map((route) => ({...route,pattern:new RegExp(`^${route.path.replace(':id','([A-Za-z0-9_-]{1,128})')}$`)}))
export const resolveNodeAdminActor = ({request,env}) => resolveAdminActor(request,env)

function authorize(ctx,route) {
  if (!route.permission) return
  const actor = resolveAdminActor(ctx.request,ctx.env)
  if (!actor) throw new AppError('后台登录已失效',401,'SESSION_EXPIRED')
  ctx.actor = actor
  if (actor.mustChangePassword && !route.allowInitial) throw new AppError('请先修改初始密码',403,'PASSWORD_CHANGE_REQUIRED')
  const permission = route.permission
  const granted = permission === 'authenticated' || (permission === 'admin' ? actor.role === 'admin' : permission === 'score-rules' ? ['admin','team_leader'].includes(actor.role) : can(actor,permission))
  if (!granted) throw new AppError('当前账号没有此操作权限',403,'FORBIDDEN')
}

export async function handleNodeDirectRoute(ctx) {
  const {request,env} = ctx
  ctx.url = new URL(request.url)
  ctx.method = request.method.toUpperCase()
  ctx.path = ctx.url.pathname.replace(/^\/api(?=\/|$)/,'') || '/'
  ctx.routeTemplate = '/api/[unmatched]'
  assertOrigin(request,env)
  if (ctx.method === 'OPTIONS') return new Response(null,{status:204,headers:JSON_HEADERS})
  if (ctx.path === '/health' && ctx.method === 'GET') {
    ctx.routeTemplate = '/api/health'
    const ready = env.EVALUATION_KV.readiness()
    return jsonResponse({success:ready,data:{status:ready ? 'ok' : 'degraded',ready,version:env.APP_VERSION || '1.5.1',uptime:Math.floor(process.uptime()),storageReady:ready,storageType:'sqlite-relational',schemaVersion:env.EVALUATION_KV.getSchemaVersion(),kvBound:true,kvReadable:true,databasePresent:ready,bootstrapReady:ready,environment:{appEnv:env.APP_ENV,storageModel:'sqlite-relational',adminSecretConfigured:Boolean(env.ADMIN_TOKEN_SECRET),publicSecretConfigured:Boolean(env.PUBLIC_TOKEN_SECRET),initialAdminPasswordConfigured:Boolean(env.INITIAL_ADMIN_PASSWORD)}}},ready ? 200 : 503)
  }
  const candidates = NODE_ROUTES.filter((route) => route.pattern.test(ctx.path))
  const route = candidates.find((candidate) => candidate.method === ctx.method)
  if (!route) {
    const error = new AppError(candidates.length ? '不支持的请求方法' : '接口不存在',candidates.length ? 405 : 404,candidates.length ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND')
    if (candidates.length) error.allow = candidates.map((candidate) => candidate.method).join(', ')
    throw error
  }
  ctx.routeTemplate = `/api${route.path}`
  ctx.params = {id:ctx.path.match(route.pattern)?.[1]}
  if (route.permission && !['GET','HEAD'].includes(ctx.method) && !request.headers.has('authorization') && request.headers.get('x-lumirror-request') !== 'fetch') throw new AppError('缺少后台安全请求头',403,'CSRF_REQUIRED')
  // Parse first; subsequent authorization observes current state after the asynchronous body read.
  ctx.input = ['GET','HEAD'].includes(ctx.method) ? {} : await bodyJson(request)
  authorize(ctx,route)
  return runWithAuditActor(ctx.actor,() => route.handler(ctx))
}
