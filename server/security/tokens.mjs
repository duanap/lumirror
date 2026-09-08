import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '../http/errors.mjs'

export function signToken(payload, secret, expiresInSeconds, nowMs = Date.now()) {
  const seconds = Number(expiresInSeconds)
  if (!secret || !Number.isInteger(seconds) || seconds < 1 || seconds > 604800) throw new AppError('Invalid session configuration',500,'SESSION_CONFIG_INVALID')
  const issuedAt = Math.floor(nowMs / 1000)
  const encoded = Buffer.from(JSON.stringify({...payload,iat:issuedAt,exp:issuedAt+seconds})).toString('base64url')
  return `${encoded}.${createHmac('sha256',secret).update(encoded).digest('base64url')}`
}

export function verifyToken(token, secret, nowMs = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 8192 || !secret) return null
    const parts = token.split('.')
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null
    const [encoded,signature] = parts
    const actual = Buffer.from(signature,'base64url')
    const expected = createHmac('sha256',secret).update(encoded).digest()
    if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return null
    const payload = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))
    const now = Math.floor(nowMs/1000)
    if (!payload || Array.isArray(payload) || !Number.isSafeInteger(payload.exp) || payload.exp <= now) return null
    if (payload.iat !== undefined && (!Number.isSafeInteger(payload.iat) || payload.iat > now+30)) return null
    return payload
  } catch { return null }
}

export function bearerToken(request) {
  const authorization = request.headers.get('authorization') || ''
  return /^Bearer\s+\S+$/i.test(authorization) ? authorization.replace(/^Bearer\s+/i,'') : ''
}
export function adminToken(request) {
  if (request.headers.has('authorization')) return bearerToken(request)
  const raw = (request.headers.get('cookie') || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('lumirror_admin='))
  try { return raw ? decodeURIComponent(raw.slice('lumirror_admin='.length)) : '' } catch { return '' }
}
export function adminCookie(token, seconds, secure = true) {
  return `lumirror_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0,Math.floor(seconds))}${secure ? '; Secure' : ''}`
}
export function resolveAdminActor(request, env) {
  const payload = verifyToken(adminToken(request),env.ADMIN_TOKEN_SECRET)
  if (payload?.kind !== 'backend' || typeof payload.userId !== 'string') return null
  const user = env.USER_REPOSITORY.findUser(payload.userId)
  if (!user || user.status !== 'active' || Number(payload.authVersion || 0) !== Number(user.authVersion || 0)) return null
  return {...payload,userId:user.id,username:user.username,role:user.role,teamId:user.teamId || '',departmentId:user.departmentId || '',employeeId:user.employeeId || '',mustChangePassword:Boolean(user.mustChangePassword),authVersion:Number(user.authVersion || 0)}
}
export function publicAuthVersion(env) {
  const row = env.EVALUATION_KV.database.prepare("SELECT COALESCE(json_extract(extra_json,'$.publicAuthVersion'),0) AS value FROM app_state WHERE singleton=1").get()
  return Number(row?.value || 0)
}
export function publicSession(request, env) {
  const payload = verifyToken(bearerToken(request),env.PUBLIC_TOKEN_SECRET)
  return payload?.role === 'evaluator' && typeof payload.evaluationCodeId === 'string' && typeof payload.verifyCodeId === 'string' && Number(payload.publicVersion || 0) === publicAuthVersion(env) ? payload : null
}
