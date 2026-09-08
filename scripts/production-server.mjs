import http from 'node:http'
import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { RelationalSqliteStorage } from '../server/repositories/sqlite/storage.mjs'
import { bootstrapDatabase } from '../server/app/bootstrap.mjs'
import { createApplication } from '../server/app/create-application.mjs'
import { createRequestHandler } from '../server/http/node-adapter.mjs'

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
function seconds(name,fallback,min,max) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`)
  return value
}
const configuration = {
  APP_ENV:process.env.APP_ENV || 'production',
  APP_VERSION:process.env.APP_VERSION || '1.5.1',
  ADMIN_TOKEN_SECRET:required('ADMIN_TOKEN_SECRET'),PUBLIC_TOKEN_SECRET:required('PUBLIC_TOKEN_SECRET'),
  INITIAL_ADMIN_PASSWORD:process.env.INITIAL_ADMIN_PASSWORD || '',
  ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS || '',SESSION_COOKIE_SECURE:process.env.SESSION_COOKIE_SECURE || 'true',
  ADMIN_SESSION_SECONDS:seconds('ADMIN_SESSION_SECONDS',28800,60,604800),
  PUBLIC_SESSION_SECONDS:seconds('PUBLIC_SESSION_SECONDS',7200,60,14400),
  TIMED_INVITE_SECONDS:seconds('TIMED_INVITE_SECONDS',300,1,3600),
  BOOTSTRAP_DEMO_DATA:process.env.BOOTSTRAP_DEMO_DATA || 'true',TRUST_PROXY:process.env.TRUST_PROXY || 'loopback'
}
if (configuration.APP_ENV !== 'production') throw new Error('APP_ENV must be production')
if (configuration.ADMIN_TOKEN_SECRET === configuration.PUBLIC_TOKEN_SECRET) throw new Error('Admin and public token secrets must be different')
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3020)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port')
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(),'data'))
const databaseFile = path.join(dataDir,'lumirror.sqlite')
process.umask(0o077)
await mkdir(dataDir,{recursive:true,mode:0o700})
const storage = new RelationalSqliteStorage(databaseFile)
try {
  await bootstrapDatabase(storage,configuration)
  if (!storage.readiness()) throw new Error('Database is not ready; an active administrator is required')
  await chmod(dataDir,0o700)
  await chmod(databaseFile,0o600)
} catch (error) { storage.close(); throw error }
const env = createApplication(storage,configuration)
const handleRequest = createRequestHandler(env)
const server = http.createServer((req, res) => { void handleRequest(req, res) })
server.requestTimeout = 15000
server.headersTimeout = 10000
server.keepAliveTimeout = 5000
server.listen(port,host,() => console.log(JSON.stringify({event:'server.ready',host,port,storage:'sqlite-relational',schemaVersion:4})))

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(JSON.stringify({event:'server.stopping',signal}))
  server.close(() => {
    try { storage.close(); process.exitCode = 0 }
    catch { process.exitCode = 1 }
  })
  server.closeIdleConnections()
  setTimeout(() => { server.closeAllConnections(); process.exit(1) },10000).unref()
}
process.once('SIGTERM',() => shutdown('SIGTERM'))
process.once('SIGINT',() => shutdown('SIGINT'))
