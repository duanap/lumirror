import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { DatabaseSync } from 'node:sqlite'

const projectRoot = path.resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(path.join(tmpdir(), 'lumirror-server-'))
const initialPassword = 'server-initial-password'
const changedPassword = 'server-changed-password'

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function startServer({ includeBootstrapPassword }) {
  const port = await availablePort()
  const env = {
    ...process.env,
    APP_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    ADMIN_TOKEN_SECRET: 'server-test-admin-secret',
    PUBLIC_TOKEN_SECRET: 'server-test-public-secret',
    ALLOWED_ORIGINS: 'https://lumirror.duanap.cn',
    SESSION_COOKIE_SECURE: 'true'
  }
  if (includeBootstrapPassword) env.INITIAL_ADMIN_PASSWORD = initialPassword
  const child = spawn(process.execPath, ['scripts/production-server.mjs'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const baseUrl = `http://127.0.0.1:${port}/api`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`production server exited early: ${stderr}`)
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.status === 200) return { child, baseUrl }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill('SIGTERM')
  throw new Error(`production server did not become ready: ${stderr}`)
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function call(baseUrl, route, { method = 'GET', token, cookie, body } = {}) {
  const headers = new Headers()
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (cookie) headers.set('cookie', cookie)
  if (cookie && route.startsWith('/admin') && method !== 'GET') headers.set('x-lumirror-request', 'fetch')
  if (body) headers.set('content-type', 'application/json')
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const setCookie = response.headers.get('set-cookie')
  return {
    status: response.status,
    payload: await response.json(),
    cookie: setCookie?.split(';')[0] || cookie || ''
  }
}

let running
try {
  await writeFile(path.join(dataDir, 'employee-review-db.json'), '{"legacy":true}', { mode: 0o600 })
  running = await startServer({ includeBootstrapPassword: true })
  const health = await call(running.baseUrl, '/health')
  assert.equal(health.status, 200)
  assert.equal(health.payload.data.ready, true)
  assert.equal(health.payload.data.kvBound, true)
  assert.equal(health.payload.data.environment.storageModel, 'sqlite-relational')

  const login = await call(running.baseUrl, '/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: initialPassword }
  })
  assert.equal(login.status, 200)
  const adminCookie = login.cookie

  const sqliteHeader = await readFile(path.join(dataDir, 'lumirror.sqlite'))
  assert.equal(sqliteHeader.subarray(0, 16).toString('utf8'), 'SQLite format 3\u0000')

  const passwordChange = await call(running.baseUrl, '/admin/change-password', {
    method: 'POST',
    cookie: adminCookie,
    body: { currentPassword: initialPassword, newPassword: changedPassword, confirmPassword: changedPassword }
  })
  assert.equal(passwordChange.status, 200)

  const now = Date.now()
  const created = await call(running.baseUrl, '/admin/evaluation-activities/create-flow', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '服务器并发测试',
      teamId: 'team_rd',
      participantMode: 'selected',
      participantEmployeeIds: ['emp_001'],
      targetMode: 'selected',
      targetEmployeeIds: ['emp_002', 'emp_003'],
      excludeSelf: true,
      startTime: new Date(now - 60_000).toISOString(),
      endTime: new Date(now + 86_400_000).toISOString()
    }
  })
  assert.equal(created.status, 200)
  assert.equal(created.payload.data.taskCount, 2)

  const activity = created.payload.data.activity
  const verify = created.payload.data.verifyCodes[0]
  const entry = await call(running.baseUrl, '/public/verify-entry', {
    method: 'POST',
    body: { evaluationCode: activity.linkCode, verifyCode: verify.code }
  })
  assert.equal(entry.status, 200)

  const tasks = await call(running.baseUrl, `/admin/tasks?evaluationCodeId=${activity.id}`, { cookie: adminCookie })
  assert.equal(tasks.status, 200)
  const taskIds = tasks.payload.data.items
    .filter((item) => item.verifyCodeId === verify.id)
    .map((item) => item.id)
  assert.equal(taskIds.length, 2)

  const submissions = await Promise.all(taskIds.map((taskId) => call(running.baseUrl, '/public/submit-score', {
    method: 'POST',
    token: entry.payload.token,
    body: { taskId, scores: { ability: 90, attitude: 90, collaboration: 90 } }
  })))
  assert.ok(submissions.every((submission) => submission.status === 200))

  const results = await call(running.baseUrl, `/admin/results?evaluationCodeId=${activity.id}`, { cookie: adminCookie })
  assert.equal(results.status, 200)
  assert.equal(results.payload.data.items.reduce((total, item) => total + Number(item.reviewCount || 0), 0), 2)

  const employeesBeforeFailedWrite = await call(running.baseUrl, '/admin/employees', { cookie: adminCookie })
  const backup = await call(running.baseUrl, '/admin/export/full-json', {
    method: 'POST', cookie: adminCookie, body: { confirm: 'EXPORT_FULL_BACKUP' }
  })
  assert.equal(backup.status, 200)
  const invalidSnapshot = structuredClone(backup.payload.data)
  invalidSnapshot.employees.push({ ...invalidSnapshot.employees[0] })
  const failedWrite = await call(running.baseUrl, '/admin/import/json', {
    method: 'POST', cookie: adminCookie, body: { data:invalidSnapshot }
  })
  assert.equal(failedWrite.status, 503)
  assert.equal(failedWrite.payload.code, 'KV_WRITE_FAILED')
  const employeesAfterFailedWrite = await call(running.baseUrl, '/admin/employees', { cookie: adminCookie })
  assert.equal(employeesAfterFailedWrite.payload.data.items.length, employeesBeforeFailedWrite.payload.data.items.length)

  const database = new DatabaseSync(path.join(dataDir, 'lumirror.sqlite'))
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
  for (const table of ['users', 'departments', 'teams', 'employees', 'review_periods', 'evaluation_activities', 'evaluation_rules', 'evaluation_participants', 'evaluation_targets', 'verification_codes', 'evaluation_tasks', 'scores', 'score_values', 'timed_invites', 'audit_logs', 'settings']) {
    assert.ok(tables.includes(table), `missing relational business table: ${table}`)
  }
  assert.ok(!tables.includes('kv_store'), 'business data must not be stored as one KV JSON document')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 2)
  database.close()

  await stopServer(running.child)
  running = await startServer({ includeBootstrapPassword: false })
  const persistedLogin = await call(running.baseUrl, '/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: changedPassword }
  })
  assert.equal(persistedLogin.status, 200)

  console.log('Production relational SQLite smoke test passed: business tables, bootstrap, restart persistence, atomic writes, and concurrent scoring')
} finally {
  if (running?.child) await stopServer(running.child)
  await rm(dataDir, { recursive: true, force: true })
}
