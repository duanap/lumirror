import http from 'node:http'
import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import onRequest from '../edge-functions/api/[[default]].js'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const DATABASE_KEY = 'employee_review_db_v1'

class SqliteKV {
  constructor(databaseFile) {
    this.database = new DatabaseSync(databaseFile)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    this.readStatement = this.database.prepare('SELECT value FROM kv_store WHERE key = ?')
    this.writeStatement = this.database.prepare(`
      INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
  }

  async get(key, options = {}) {
    if (key !== DATABASE_KEY) return null
    const value = this.readStatement.get(key)?.value ?? null
    if (value === null) return null
    return options.type === 'json' ? JSON.parse(value) : value
  }

  async put(key, value) {
    if (key !== DATABASE_KEY) throw new Error(`Unsupported storage key: ${key}`)
    this.writeStatement.run(key, String(value), new Date().toISOString())
  }

  close() {
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.database.close()
  }
}

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

function writeNodeResponse(res, response) {
  const headers = Object.fromEntries(response.headers.entries())
  res.writeHead(response.status, headers)
  return response.arrayBuffer().then((body) => res.end(Buffer.from(body)))
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
const storage = new SqliteKV(databaseFile)
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
  EVALUATION_KV: storage
}

let requestQueue = Promise.resolve()

async function handleRequest(req, res) {
  try {
    const headers = requestHeaders(req)
    const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
    const hostHeader = headers.get('host') || `${host}:${port}`
    const request = new Request(`${protocol}://${hostHeader}${req.url || '/'}`, {
      method: req.method,
      headers,
      body: await requestBody(req)
    })
    const response = await onRequest({ request, params: {}, env })
    await writeNodeResponse(res, response)
  } catch (error) {
    if (res.headersSent) return res.end()
    const status = Number(error?.status) || 500
    const message = status === 413 ? '请求体过大' : '服务器内部错误'
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    res.end(JSON.stringify({ success: false, message }))
    if (status >= 500) console.error('[lumirror-server]', error)
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
