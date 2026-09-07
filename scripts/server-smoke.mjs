import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { RelationalSqliteStorage } from './sqlite-storage.mjs'

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
    cookie: setCookie?.split(';')[0] || cookie || '',
    requestId: response.headers.get('x-request-id')
  }
}

let running
try {
  const schemaOneFile = path.join(dataDir, 'schema-one.sqlite')
  const schemaOne = new DatabaseSync(schemaOneFile)
  schemaOne.exec(`
    CREATE TABLE app_state (singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, domain_version INTEGER NOT NULL, created_at TEXT, updated_at TEXT, extra_json TEXT NOT NULL);
    INSERT INTO app_state VALUES (1, 1, 3, NULL, NULL, '{}');
    CREATE TABLE evaluation_rules (evaluation_id TEXT NOT NULL, rule_id TEXT NOT NULL, name TEXT NOT NULL, min_value REAL NOT NULL, max_value REAL NOT NULL, weight REAL NOT NULL, enabled INTEGER NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (evaluation_id, rule_id));
    CREATE TABLE evaluation_targets (evaluation_id TEXT NOT NULL, employee_id TEXT NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (evaluation_id, employee_id));
    INSERT INTO evaluation_targets VALUES ('eval_legacy', 'emp_legacy', 0);
    CREATE TABLE evaluation_tasks (id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, verification_code_id TEXT NOT NULL, target_employee_id TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL);
    INSERT INTO evaluation_tasks VALUES ('task_legacy', 'eval_legacy', 'verify_legacy', 'emp_legacy', 'submitted', '{"id":"task_legacy","evaluationCodeId":"eval_legacy","verifyCodeId":"verify_legacy","targetEmployeeId":"emp_legacy","status":"submitted"}', 0);
    CREATE TABLE scores (id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE, target_employee_id TEXT NOT NULL, total REAL NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL, list_order INTEGER NOT NULL);
    INSERT INTO scores VALUES ('score_legacy', 'eval_legacy', 'task_legacy', 'emp_legacy', 90, '2026-01-01T00:00:00.000Z', '{"id":"score_legacy","evaluationCodeId":"eval_legacy","taskId":"task_legacy","targetEmployeeId":"emp_legacy","total":90,"createdAt":"2026-01-01T00:00:00.000Z"}', 0);
    CREATE TABLE score_values (score_id TEXT NOT NULL, rule_id TEXT NOT NULL, value REAL NOT NULL, list_order INTEGER NOT NULL, PRIMARY KEY (score_id, rule_id));
    INSERT INTO score_values VALUES ('score_legacy', 'ability', 90, 0);
    CREATE INDEX idx_scores_evaluation_target ON scores(evaluation_id, target_employee_id);
  `)
  schemaOne.close()
  const migratedStorage = new RelationalSqliteStorage(schemaOneFile)
  assert.ok(migratedStorage.database.prepare('PRAGMA table_info(evaluation_rules)').all().some((column) => column.name === 'operation'))
  assert.equal(migratedStorage.database.prepare('SELECT schema_version FROM app_state WHERE singleton = 1').get().schema_version, 4)
  assert.ok(migratedStorage.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_tags'").get())
  assert.ok(migratedStorage.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='employee_tags'").get())
  for (const table of ['evaluation_targets','evaluation_tasks','scores']) {
    const legacyTarget = migratedStorage.database.prepare(`SELECT target_type, target_id FROM ${table}`).get()
    assert.equal(legacyTarget.target_type,'employee')
    assert.equal(legacyTarget.target_id,'emp_legacy')
  }
  migratedStorage.close()

  const tagSchemaThreeFile = path.join(dataDir, 'schema-three-without-tags.sqlite')
  const tagSchemaFourStorage = new RelationalSqliteStorage(tagSchemaThreeFile)
  await tagSchemaFourStorage.put('employee_review_db_v1',{
    version:4,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',
    users:[],departments:[{id:'dep_legacy',name:'旧部门',status:'active'}],teams:[{id:'team_legacy',departmentId:'dep_legacy',name:'旧团队',status:'active'}],employees:[{id:'emp_legacy',departmentId:'dep_legacy',teamId:'team_legacy',name:'旧成员',status:'active',gender:'unknown',position:'成员'}],memberTags:[],periods:[],evaluationCodes:[],verifyCodes:[],tasks:[],scores:[],timedInvites:[],logs:[],settings:{systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
  })
  tagSchemaFourStorage.close()
  const schemaThree = new DatabaseSync(tagSchemaThreeFile)
  schemaThree.exec('PRAGMA foreign_keys = OFF; DROP TABLE employee_tags; DROP TABLE member_tags; UPDATE app_state SET schema_version = 3 WHERE singleton = 1; PRAGMA foreign_keys = ON;')
  schemaThree.close()
  const migratedTagStorage = new RelationalSqliteStorage(tagSchemaThreeFile)
  const migratedTagData = await migratedTagStorage.get('employee_review_db_v1',{type:'json'})
  assert.deepEqual(migratedTagData.employees[0].tagIds,[])
  assert.equal(migratedTagStorage.database.prepare('SELECT schema_version FROM app_state WHERE singleton = 1').get().schema_version,4)
  assert.equal(migratedTagStorage.database.prepare('PRAGMA foreign_key_check').all().length,0)
  migratedTagStorage.close()

  await writeFile(path.join(dataDir, 'employee-review-db.json'), '{"legacy":true}', { mode: 0o600 })
  running = await startServer({ includeBootstrapPassword: true })
  const health = await call(running.baseUrl, '/health')
  assert.equal(health.status, 200)
  const busyStorage = new RelationalSqliteStorage(path.join(dataDir, 'lumirror.sqlite'))
  assert.equal(busyStorage.database.prepare('PRAGMA busy_timeout').get().timeout,5000)
  busyStorage.close()
  assert.equal(health.payload.data.ready, true)
  assert.match(health.requestId,/^[0-9a-f-]{36}$/)
  assert.equal(health.payload.data.storageReady,true)
  assert.equal(health.payload.data.storageType,'sqlite-relational')
  assert.equal(health.payload.data.schemaVersion,4)
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

  const memberTag = await call(running.baseUrl, '/admin/member-tags', {
    method: 'POST', cookie: adminCookie, body: { name:'服务器标签' }
  })
  assert.equal(memberTag.status, 200)
  const taggedEmployee = await call(running.baseUrl, '/admin/employees/emp_003', {
    method: 'PUT', cookie: adminCookie,
    body: { name:'王敏', gender:'female', departmentId:'dep_rd', teamId:'team_rd', position:'产品经理', status:'active', avatar:'avatar_female_young_plain', tagIds:[memberTag.payload.data.id] }
  })
  assert.equal(taggedEmployee.status, 200)

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

  const currentTask = await call(running.baseUrl, '/public/current-task', { token: entry.payload.token })
  assert.equal(currentTask.status, 200)
  assert.equal(currentTask.payload.data.targetType, 'employee')
  assert.equal(currentTask.payload.data.remaining, 2)
  assert.equal(currentTask.payload.data.rules.length, 3)

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
  const duplicateSubmission = await call(running.baseUrl, '/public/submit-score', {
    method: 'POST', token: entry.payload.token,
    body: { taskId: taskIds[0], scores: { ability: 90, attitude: 90, collaboration: 90 } }
  })
  assert.equal(duplicateSubmission.status, 409)
  assert.equal(duplicateSubmission.payload.code, 'TASK_ALREADY_SUBMITTED')

  const results = await call(running.baseUrl, `/admin/results?evaluationCodeId=${activity.id}`, { cookie: adminCookie })
  assert.equal(results.status, 200)
  assert.equal(results.payload.data.activity.rules.length, 3)
  assert.deepEqual(results.payload.data.activity.participantEmployeeIds, ['emp_001'])
  assert.equal(results.payload.data.items.reduce((total, item) => total + Number(item.reviewCount || 0), 0), 2)
  const endedActivity = await call(running.baseUrl, `/admin/evaluation-codes/${activity.id}`, {
    method:'PUT',cookie:adminCookie,body:{endTime:new Date(Date.now()-1_000).toISOString()}
  })
  assert.equal(endedActivity.status,200)
  const archivedActivity = await call(running.baseUrl, `/admin/evaluation-codes/${activity.id}`, {
    method:'PUT',cookie:adminCookie,body:{status:'archived'}
  })
  assert.equal(archivedActivity.status,200)
  const archivedResults = await call(running.baseUrl, `/admin/results?evaluationCodeId=${activity.id}`, { cookie: adminCookie })
  assert.deepEqual(archivedResults.payload.data.items,results.payload.data.items)
  const archivedTrend = await call(running.baseUrl, '/admin/trends?targetType=employee&targetId=emp_002', { cookie:adminCookie })
  assert.equal(archivedTrend.status,200)
  assert.equal(archivedTrend.payload.data.points.length,1)
  assert.equal(archivedTrend.payload.data.points[0].archived,true)

  const teamCreated = await call(running.baseUrl, '/admin/evaluation-activities/create-flow', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '服务器团队评价测试',
      teamId: 'team_rd',
      participantMode: 'selected',
      participantEmployeeIds: ['emp_001'],
      targetType: 'team',
      targetMode: 'selected',
      targetTeamIds: ['team_rd', 'team_pm'],
      startTime: new Date(now - 60_000).toISOString(),
      endTime: new Date(now + 86_400_000).toISOString()
    }
  })
  assert.equal(teamCreated.status, 200)
  assert.equal(teamCreated.payload.data.activity.targetType, 'team')
  assert.equal(teamCreated.payload.data.taskCount, 2)

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
  for (const table of ['users', 'departments', 'teams', 'employees', 'member_tags', 'employee_tags', 'review_periods', 'evaluation_activities', 'evaluation_rules', 'evaluation_participants', 'evaluation_targets', 'verification_codes', 'evaluation_tasks', 'scores', 'score_values', 'timed_invites', 'audit_logs', 'settings']) {
    assert.ok(tables.includes(table), `missing relational business table: ${table}`)
  }
  assert.ok(database.prepare('PRAGMA table_info(evaluation_rules)').all().some((column) => column.name === 'operation'), 'evaluation_rules.operation must be queryable')
  assert.equal(database.prepare('SELECT schema_version FROM app_state WHERE singleton = 1').get().schema_version, 4)
  assert.ok(!tables.includes('kv_store'), 'business data must not be stored as one KV JSON document')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 2)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'score.submit'").get().count, 2)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evaluation_targets WHERE target_type = 'team'").get().count, 2)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM evaluation_tasks WHERE target_type = 'team'").get().count, 2)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM member_tags').get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM employee_tags').get().count, 1)
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  database.close()

  await stopServer(running.child)
  running = await startServer({ includeBootstrapPassword: false })
  const persistedLogin = await call(running.baseUrl, '/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: changedPassword }
  })
  assert.equal(persistedLogin.status, 200)
  const persistedEmployees = await call(running.baseUrl, '/admin/employees', { cookie:persistedLogin.cookie })
  assert.equal(persistedEmployees.status, 200)
  assert.equal(persistedEmployees.payload.data.items.find((item) => item.id === 'emp_003').tags[0].name, '服务器标签')
  const persistedArchivedResults = await call(running.baseUrl, `/admin/results?evaluationCodeId=${activity.id}`, { cookie:persistedLogin.cookie })
  assert.deepEqual(persistedArchivedResults.payload.data.items,results.payload.data.items)
  const persistedArchivedTrend = await call(running.baseUrl, '/admin/trends?targetType=employee&targetId=emp_002', { cookie:persistedLogin.cookie })
  assert.deepEqual(persistedArchivedTrend.payload.data.points,archivedTrend.payload.data.points)
  const unarchivedActivity = await call(running.baseUrl, `/admin/evaluation-codes/${activity.id}`, {
    method:'PUT',cookie:persistedLogin.cookie,body:{status:'active'}
  })
  assert.equal(unarchivedActivity.status,200)
  assert.equal(unarchivedActivity.payload.data.status,'ended')
  const unarchivedResults = await call(running.baseUrl, `/admin/results?evaluationCodeId=${activity.id}`, { cookie:persistedLogin.cookie })
  assert.deepEqual(unarchivedResults.payload.data.items,results.payload.data.items)

  console.log('Production relational SQLite smoke test passed: schema-v1 upgrade, rule operation column, bootstrap, restart persistence, atomic writes and concurrent scoring')
} finally {
  if (running?.child) await stopServer(running.child)
  await rm(dataDir, { recursive: true, force: true })
}
