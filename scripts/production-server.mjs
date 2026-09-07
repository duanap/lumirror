import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import onRequest from '../edge-functions/api/[[default]].js'
import { handleNodeDirectRoute, resolveNodeAdminActor } from '../server/node-direct-routes.mjs'
import { runWithAuditActor } from '../server/request-context.mjs'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'
import { SqliteScoreRepository } from '../server/repositories/sqlite/score-repository.mjs'
import { SqliteTaskRepository } from '../server/repositories/sqlite/task-repository.mjs'
import { SqlitePeriodRepository } from '../server/repositories/sqlite/period-repository.mjs'
import { SqliteEvaluationRepository } from '../server/repositories/sqlite/evaluation-repository.mjs'
import { SqliteEmployeeRepository } from '../server/repositories/sqlite/employee-repository.mjs'
import { SqliteOrganizationRepository } from '../server/repositories/sqlite/organization-repository.mjs'
import { SqliteUserRepository } from '../server/repositories/sqlite/user-repository.mjs'
import { SqliteAuditRepository } from '../server/repositories/sqlite/audit-repository.mjs'
import { SqliteSettingsRepository } from '../server/repositories/sqlite/settings-repository.mjs'
import { SqliteBatchRepository } from '../server/repositories/sqlite/batch-repository.mjs'
import { SqliteMaintenanceRepository } from '../server/repositories/sqlite/maintenance-repository.mjs'

const MAX_BODY_BYTES = 2 * 1024 * 1024
function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  return headers
}

async function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body exceeds limit')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

async function writeNodeResponse(res, response, requestId) {
  const headers = new Headers(response.headers)
  headers.set('x-request-id',requestId)
  const body = Buffer.from(await response.arrayBuffer())
  res.writeHead(response.status, Object.fromEntries(headers.entries()))
  res.end(body)
  return body
}

function routePath(req) {
  return String(req.url || '/').split('?')[0] || '/'
}

function resourceType(route) {
  const parts = route.replace(/^\/api\/?/,'').split('/').filter(Boolean)
  return parts[1] || parts[0] || 'root'
}

function userRole(req) {
  const authorization = String(req.headers.authorization || '')
  const cookie = String(req.headers.cookie || '')
  const token = authorization.replace(/^Bearer\s+/i,'') || cookie.match(/(?:^|;\s*)lumirror_admin=([^;]+)/)?.[1]
  if (!token) return 'anonymous'
  try {
    const encoded = decodeURIComponent(token).split('.')[0]
    const payload = JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))
    return String(payload.role || 'authenticated')
  } catch {
    return 'authenticated'
  }
}

function responseErrorCode(body) {
  try {
    const payload = JSON.parse(body.toString('utf8'))
    return payload?.code || null
  } catch {
    return null
  }
}

function logRequest({ requestId, method, route, status, durationMs, role, errorCode, internalError }) {
  const level = status >= 500 || internalError ? 'error' : status >= 400 ? 'warn' : durationMs > 500 ? 'warn' : 'info'
  const record = {
    timestamp: new Date().toISOString(), requestId, method, route, status, durationMs,
    userRole:role, resourceType:resourceType(route), errorCode:errorCode || null, level
  }
  if (durationMs > 2000) record.slowRequest = 'critical'
  else if (durationMs > 500) record.slowRequest = 'slow'
  console.log(JSON.stringify(record))
  if (internalError) {
    console.error(JSON.stringify({
      timestamp:new Date().toISOString(),requestId,level:'error',errorType:internalError.name || 'Error',
      errorMessage:String(internalError.message || 'Unknown server error').slice(0,240)
    }))
  }
}

const appEnv = process.env.APP_ENV || 'production'
if (appEnv !== 'production') throw new Error('APP_ENV must be production')

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3020)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port')

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'))
const databaseFile = path.join(dataDir, 'lumirror.sqlite')
process.umask(0o077)
await mkdir(dataDir, { recursive: true, mode: 0o700 })
await chmod(dataDir, 0o700)
const storage = new RelationalSqliteStorage(databaseFile)
const scoreRepository = new SqliteScoreRepository(storage)
const taskRepository = new SqliteTaskRepository(storage)
const periodRepository = new SqlitePeriodRepository(storage)
const evaluationRepository = new SqliteEvaluationRepository(storage)
const employeeRepository = new SqliteEmployeeRepository(storage)
const organizationRepository = new SqliteOrganizationRepository(storage)
const userRepository = new SqliteUserRepository(storage)
const auditRepository = new SqliteAuditRepository(storage)
const settingsRepository = new SqliteSettingsRepository(storage)
const batchRepository = new SqliteBatchRepository({storage,employeeRepository,userRepository,organizationRepository,periodRepository,evaluationRepository,taskRepository})
const maintenanceRepository = new SqliteMaintenanceRepository(storage)
await chmod(databaseFile, 0o600)

const env = {
  APP_ENV: appEnv,
  ADMIN_TOKEN_SECRET: requiredEnvironment('ADMIN_TOKEN_SECRET'),
  PUBLIC_TOKEN_SECRET: requiredEnvironment('PUBLIC_TOKEN_SECRET'),
  INITIAL_ADMIN_PASSWORD: process.env.INITIAL_ADMIN_PASSWORD || '',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  SESSION_COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE || 'true',
  ADMIN_SESSION_SECONDS: process.env.ADMIN_SESSION_SECONDS || '',
  PUBLIC_SESSION_SECONDS: process.env.PUBLIC_SESSION_SECONDS || '',
  STORAGE_MODEL: 'sqlite-relational',
  EVALUATION_KV: storage,
  SCORE_REPOSITORY: scoreRepository,
  TASK_REPOSITORY: taskRepository,
  PERIOD_REPOSITORY: periodRepository,
  EVALUATION_REPOSITORY: evaluationRepository,
  EMPLOYEE_REPOSITORY: employeeRepository,
  ORGANIZATION_REPOSITORY: organizationRepository,
  USER_REPOSITORY: userRepository,
  AUDIT_REPOSITORY: auditRepository,
  SETTINGS_REPOSITORY: settingsRepository,
  BATCH_REPOSITORY: batchRepository,
  MAINTENANCE_REPOSITORY: maintenanceRepository
}

let requestQueue = Promise.resolve()

async function handleRequest(req, res) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const route = routePath(req)
  const role = userRole(req)
  let status = 500
  let errorCode = null
  let internalError = null
  try {
    const headers = requestHeaders(req)
    const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
    const hostHeader = headers.get('host') || `${host}:${port}`
    const request = new Request(`${protocol}://${hostHeader}${req.url || '/'}`, {
      method: req.method,
      headers,
      body: await requestBody(req)
    })
    const actor = resolveNodeAdminActor({request,env,userRepository})
    const response = await runWithAuditActor(actor,async () => {
      const directResponse = await handleNodeDirectRoute({request,env,requestId})
      return directResponse || await onRequest({ request, params: {}, env, requestId })
    })
    status = response.status
    const body = await writeNodeResponse(res, response, requestId)
    errorCode = responseErrorCode(body)
  } catch (error) {
    internalError = Number(error?.status) >= 500 ? error : null
    if (res.headersSent) return res.end()
    status = Number(error?.status) || 500
    errorCode = error?.code || (status === 413 ? 'PAYLOAD_TOO_LARGE' : status >= 500 ? 'INTERNAL_ERROR' : null)
    const message = status === 413 ? '请求体过大' : '服务器内部错误'
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId
    })
    res.end(JSON.stringify({ success: false, message }))
  } finally {
    logRequest({requestId,method:req.method || 'GET',route,status,durationMs:Date.now() - startedAt,role,errorCode,internalError})
  }
}

const server = http.createServer((req, res) => {
  const current = requestQueue.then(() => handleRequest(req, res))
  requestQueue = current.catch(() => {})
})
server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000

server.listen(port, host, () => {
  console.log(`Lumirror API listening on http://${host}:${port}`)
})

async function shutdown(signal) {
  console.log(`Lumirror API received ${signal}; shutting down`)
  server.close(async () => {
    await requestQueue
    storage.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
