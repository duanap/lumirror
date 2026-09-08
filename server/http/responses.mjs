import { AppError } from './errors.mjs'

export const JSON_HEADERS = Object.freeze({
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
  'access-control-expose-headers':'x-request-id,retry-after',
  'access-control-max-age':'600'
})
export const jsonResponse = (payload,status = 200,headers = {}) => new Response(JSON.stringify(payload),{status,headers:{...JSON_HEADERS,...headers}})
export const ok = (data,headers = {}) => jsonResponse({success:true,data},200,headers)
const normalize = (value) => String(value || '').trim().replace(/\/+$/,'')
export function allowedOrigin(request,env) {
  const origin = normalize(request.headers.get('origin'))
  if (!origin) return ''
  const allowlist = String(env.ALLOWED_ORIGINS || '').split(',').map(normalize).filter(Boolean)
  return origin === new URL(request.url).origin || allowlist.includes(origin) ? origin : ''
}
export function assertOrigin(request,env) {
  if (request.headers.has('origin') && !allowedOrigin(request,env)) throw new AppError('请求来源不受信任',403,'ORIGIN_FORBIDDEN')
}
export function responseHeaders(response,{request,env,requestId}) {
  const headers = new Headers(response.headers)
  for (const [key,value] of Object.entries(JSON_HEADERS)) if (!headers.has(key)) headers.set(key,value)
  headers.set('x-request-id',requestId)
  headers.set('vary','Origin')
  const origin = allowedOrigin(request,env)
  if (origin) { headers.set('access-control-allow-origin',origin); headers.set('access-control-allow-credentials','true') }
  else { headers.delete('access-control-allow-origin'); headers.delete('access-control-allow-credentials') }
  return new Response(response.body,{status:response.status,headers})
}
