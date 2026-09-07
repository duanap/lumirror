import { createHmac, timingSafeEqual } from 'node:crypto'

const JSON_HEADERS = {
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store, no-cache, must-revalidate',
  pragma:'no-cache',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy':'same-origin',
  'access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers':'content-type,authorization,x-lumirror-request',
  'access-control-expose-headers':'x-request-id',
  'access-control-max-age':'600'
}

const ok = (data) => new Response(JSON.stringify({success:true,data}),{status:200,headers:JSON_HEADERS})
const fail = (message,status=400,code) => new Response(JSON.stringify({success:false,message,...(code?{code}:{})}),{status,headers:JSON_HEADERS})

function normalizeOrigin(value) { return String(value || '').trim().replace(/\/+$/,'') }

function withHeaders(response, {request,env,requestId}) {
  const headers = new Headers(response.headers)
  headers.set('x-request-id',requestId)
  const origin = normalizeOrigin(request.headers.get('origin'))
  const allowlist = String(env.ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean)
  if (origin && allowlist.includes(origin)) {
    headers.set('access-control-allow-origin',origin)
    headers.set('access-control-allow-credentials','true')
    headers.set('vary','Origin')
  } else {
    headers.delete('access-control-allow-origin')
    headers.delete('access-control-allow-credentials')
  }
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers})
}

function adminToken(request) {
  const authorization = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i,'')
  if (authorization) return authorization
  const cookie = String(request.headers.get('cookie') || '')
  const raw = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith('lumirror_admin='))
  return raw ? decodeURIComponent(raw.slice('lumirror_admin='.length)) : ''
}

function verifyAdminToken(token, secret) {
  try {
    const [encoded,signatureText] = String(token || '').split('.')
    if (!encoded || !signatureText || !secret) return null
    const actual = Buffer.from(signatureText,'base64url')
    const expected = createHmac('sha256',String(secret)).update(encoded).digest()
    if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null
    const payload = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))
    if (payload?.kind !== 'backend' || !payload.exp || Number(payload.exp) < Math.floor(Date.now()/1000)) return null
    return payload
  } catch { return null }
}

export function resolveNodeAdminActor({request,env,userRepository}) {
  if (!userRepository?.findUser) return null
  const token = verifyAdminToken(adminToken(request),env.ADMIN_TOKEN_SECRET)
  if (!token) return null
  const user = userRepository.findUser(token.userId)
  if (!user || user.status !== 'active') return null
  return {...token,userId:user.id,username:user.username,role:user.role,teamId:user.teamId || '',departmentId:user.departmentId || '',employeeId:user.employeeId || ''}
}

async function bodyJson(request) {
  try {
    const text = await request.text()
    return text.trim() ? JSON.parse(text) : {}
  } catch { return {} }
}

const directRoutes = new Set([
  'POST /admin/batch',
  'POST /admin/maintenance/cleanup',
  'GET /admin/export/json',
  'POST /admin/export/full-json',
  'POST /admin/import/json'
])

export async function handleNodeDirectRoute({request,env,requestId}) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/,'') || '/'
  const method = request.method.toUpperCase()
  if (!directRoutes.has(`${method} ${path}`)) return null

  const context = {request,env,requestId}
  try {
    const repository = path === '/admin/batch' ? env.BATCH_REPOSITORY : env.MAINTENANCE_REPOSITORY
    if (!repository?.findUser) return null
    const token = verifyAdminToken(adminToken(request),env.ADMIN_TOKEN_SECRET)
    if (!token) return withHeaders(fail('后台登录已失效',401),context)
    if (method !== 'GET' && !request.headers.get('authorization') && request.headers.get('x-lumirror-request') !== 'fetch') {
      return withHeaders(fail('缺少后台安全请求头',403,'CSRF_REQUIRED'),context)
    }

    const user = repository.findUser(token.userId)
    if (!user || user.status !== 'active') return withHeaders(fail('账号已停用或不存在',401),context)
    const session = {...token,userId:user.id,username:user.username,role:user.role,teamId:user.teamId || '',departmentId:user.departmentId || '',employeeId:user.employeeId || ''}
    if (user.mustChangePassword) return withHeaders(fail('请先修改默认或初始密码',403,'PASSWORD_CHANGE_REQUIRED'),context)

    if (path === '/admin/batch') {
      const result = env.BATCH_REPOSITORY.run(session,await bodyJson(request))
      return withHeaders(ok(result),context)
    }

    if (session.role !== 'admin') return withHeaders(fail('只有管理员可以执行此操作',403,'FORBIDDEN'),context)
    if (path === '/admin/maintenance/cleanup') return withHeaders(ok(env.MAINTENANCE_REPOSITORY.cleanup(session)),context)
    if (path === '/admin/export/json') return withHeaders(ok(await env.MAINTENANCE_REPOSITORY.exportSanitized()),context)
    if (path === '/admin/export/full-json') {
      const input = await bodyJson(request)
      if (input.confirm !== 'EXPORT_FULL_BACKUP') return withHeaders(fail('完整备份包含敏感邀请码和哈希，请输入确认标记',400,'CONFIRM_REQUIRED'),context)
      return withHeaders(ok(await env.MAINTENANCE_REPOSITORY.exportFull(session)),context)
    }
    if (path === '/admin/import/json') {
      const input = await bodyJson(request)
      return withHeaders(ok(await env.MAINTENANCE_REPOSITORY.importData(input.data,session)),context)
    }
    return null
  } catch (error) {
    const status = Number(error?.status) || 500
    const message = status >= 500 ? '服务器内部错误，请检查服务日志' : String(error?.message || '请求失败')
    return withHeaders(fail(message,status,error?.code || (status >= 500 ? 'INTERNAL_ERROR' : undefined)),context)
  }
}
