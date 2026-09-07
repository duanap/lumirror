// Employee Anonymous Review - API Runtime v1.5.1
// Single-file runtime entry for maximum EdgeOne compatibility.

const RUNTIME_VERSION = '1.5.1'
const DATABASE_KEY = 'employee_review_db_v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
let memoryDatabase = null
const rateBuckets = new Map()
const requestIds = new WeakMap()
const runtimeStartedAt = Date.now()
const MAX_BODY_BYTES = 2 * 1024 * 1024
const PASSWORD_ALGORITHM = 'pbkdf2-sha256'
const PASSWORD_ITERATIONS = 210000

const DEFAULT_RULES = [
  { id: 'ability', name: '工作能力', min: 60, max: 99, weight: 100, operation: 'add', enabled: true },
  { id: 'attitude', name: '工作态度', min: 60, max: 99, weight: 100, operation: 'add', enabled: true },
  { id: 'collaboration', name: '协作能力', min: 60, max: 99, weight: 100, operation: 'add', enabled: true }
]
const DEFAULT_ROUNDING = 'one_decimal'
const AVATAR_PRESET_GENDERS = {
  avatar_male_young_plain:'male', avatar_male_young_glasses:'male',
  avatar_male_adult_plain:'male', avatar_male_adult_glasses:'male',
  avatar_female_young_plain:'female', avatar_female_young_glasses:'female',
  avatar_female_adult_plain:'female', avatar_female_adult_glasses:'female'
}

const ROLE_LABELS = {
  admin: '管理员',
  team_leader: '团队长',
  leader: '领导',
  member: '成员'
}

const ROLE_PERMISSIONS = {
  admin: ['*'],
  team_leader: [
    'dashboard:view', 'employees:view', 'employees:write',
    'activities:view', 'activities:write', 'verify:view', 'verify:write',
    'tasks:view', 'tasks:write', 'results:view', 'periods:view', 'settings:password'
  ],
  leader: ['dashboard:view', 'employees:view', 'activities:view', 'verify:view', 'tasks:view', 'results:view', 'periods:view', 'settings:password'],
  member: ['dashboard:view', 'settings:password']
}

function copyJson(value) { return JSON.parse(JSON.stringify(value)) }
function normalize(value) { return String(value || '').trim() }
function normalizeEmployeeAvatar(value, gender) {
  const avatar = normalize(value)
  return AVATAR_PRESET_GENDERS[avatar] === gender ? avatar : ''
}
function normalizeMemberTagName(value) {
  const name = normalize(value).replace(/\s+/g,' ')
  if (!name || name.length > 20) throw httpError('标签名称需为 1-20 个字符')
  return name
}
function resolveMemberTagIds(db, values) {
  const validIds = new Set((db.memberTags || []).map((tag) => tag.id))
  return uniqueStrings(values).filter((id) => validIds.has(id))
}
function nowText() { return new Date().toISOString() }
function randomId(prefix = 'id') {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
function bytesToHex(bytes) { return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('') }
function bytesToBase64Url(bytes) {
  let binary = ''
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function stringToBase64Url(value) { return bytesToBase64Url(encoder.encode(value)) }
function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
function base64UrlToString(input) { return decoder.decode(base64UrlToBytes(input)) }
async function sha256(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value))) }
async function legacyHashPassword(password, salt) { return sha256(`${salt}:${password}:employee-review`) }
async function pbkdf2Password(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(String(salt)), iterations }, key, 256)
  return bytesToHex(bits)
}
async function hashPassword(password, salt) { return pbkdf2Password(password, salt) }
async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false
  if (user.passwordAlgorithm === PASSWORD_ALGORITHM) {
    const iterations = Number(user.passwordIterations || PASSWORD_ITERATIONS)
    return await pbkdf2Password(password, user.salt, iterations) === user.passwordHash
  }
  return await legacyHashPassword(password, user.salt) === user.passwordHash
}
async function setUserPassword(user, password, { forceChange = false } = {}) {
  user.salt = randomId('salt')
  user.passwordHash = await hashPassword(password, user.salt)
  user.passwordAlgorithm = PASSWORD_ALGORITHM
  user.passwordIterations = PASSWORD_ITERATIONS
  user.mustChangePassword = Boolean(forceChange)
  user.updatedAt = nowText()
}
async function upgradePasswordHashIfNeeded(user, password) {
  if (user.passwordAlgorithm === PASSWORD_ALGORITHM) return false
  await setUserPassword(user, password, { forceChange:Boolean(user.mustChangePassword) })
  return true
}
async function hashVerifyCode(evaluationCodeId, code) { return sha256(`${evaluationCodeId}:${normalize(code).toUpperCase()}`) }
async function globalCodeFingerprint(code) { return sha256(`employee-review:verify:${normalize(code).toUpperCase()}`) }

async function signToken(payload, secret, expiresInSeconds = 7200) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const encoded = stringToBase64Url(JSON.stringify(body))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encoded))
  return `${encoded}.${bytesToBase64Url(signature)}`
}
async function verifyToken(token, secret) {
  try {
    const [encoded, signature] = String(token || '').split('.')
    if (!encoded || !signature) return null
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature), encoder.encode(encoded))
    if (!valid) return null
    const payload = JSON.parse(base64UrlToString(encoded))
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}

function secureIndex(max) {
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return max > 0 ? bytes[0] % max : 0
}
function randomDigits(length) {
  return Array.from({ length }, () => String(secureIndex(10))).join('')
}
async function generateEvaluationCode(db) {
  const used = new Set((db.evaluationCodes || []).map((x) => String(x.code).toUpperCase()))
  for (let i = 0; i < 10000; i++) {
    const code = `PJ${randomDigits(4)}`
    if (!used.has(code)) return code
  }
  throw new Error('无法生成唯一评价码')
}
function generateUniqueLinkCode(db, key = 'linkCode', length = 8) {
  const used = new Set([
    ...(db.evaluationCodes || []).map((x) => String(x[key] || '')),
    ...(db.timedInvites || []).map((x) => String(x[key] || ''))
  ].filter(Boolean))
  for (let i = 0; i < 10000; i++) {
    const code = randomDigits(length)
    if (!used.has(code)) return code
  }
  throw new Error('无法生成唯一邀请链接')
}
async function generateVerifyCode(db) {
  const used = new Set((db.verifyCodes || []).map((x) => x.codeFingerprint).filter(Boolean))
  for (let i = 0; i < 10000; i++) {
    const code = randomDigits(6)
    const fingerprint = await globalCodeFingerprint(code)
    if (!used.has(fingerprint)) return { code, fingerprint }
  }
  throw new Error('无法生成唯一邀请码')
}
function maskVerifyCode(code) { return `${'*'.repeat(Math.max(0, String(code).length - 2))}${String(code).slice(-2)}` }

function getEnv(context, name, fallback = '') {
  const value = context?.env?.[name]
  return value === undefined || value === null || value === '' ? fallback : String(value)
}
function requestId(context) {
  if (!context || typeof context !== 'object') return randomId('req')
  if (!requestIds.has(context)) {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : randomId('req')
    requestIds.set(context,id)
  }
  return requestIds.get(context)
}
function isKvBinding(value) {
  return Boolean(value && typeof value === 'object' && typeof value.get === 'function' && typeof value.put === 'function')
}
function getKvBinding(context) {
  try {
    if (typeof EVALUATION_KV !== 'undefined' && isKvBinding(EVALUATION_KV)) return EVALUATION_KV
  } catch {}
  const contextual = context?.env?.EVALUATION_KV
  return isKvBinding(contextual) ? contextual : null
}
function hasPersistentKV(context) { return isKvBinding(getKvBinding(context)) }
function getScoreRepository(context) {
  const repository = context?.env?.SCORE_REPOSITORY
  return repository && typeof repository.submitAtomic === 'function' ? repository : null
}
function getTaskRepository(context) {
  const repository = context?.env?.TASK_REPOSITORY
  return repository && typeof repository.findCurrentTask === 'function' ? repository : null
}
function getPeriodRepository(context) {
  const repository = context?.env?.PERIOD_REPOSITORY
  return repository && typeof repository.list === 'function' ? repository : null
}
function getEvaluationRepository(context) {
  const repository = context?.env?.EVALUATION_REPOSITORY
  return repository && typeof repository.list === 'function' ? repository : null
}
function getEmployeeRepository(context) {
  const repository = context?.env?.EMPLOYEE_REPOSITORY
  return repository && typeof repository.list === 'function' ? repository : null
}
function getOrganizationRepository(context) {
  const repository = context?.env?.ORGANIZATION_REPOSITORY
  return repository && typeof repository.list === 'function' ? repository : null
}

async function createSeedDatabase(context) {
  const now = nowText()
  const initialAdminPassword = getEnv(context,'INITIAL_ADMIN_PASSWORD',getEnv(context,'APP_ENV','development') === 'production' ? '' : 'admin123')
  if (!initialAdminPassword) throw new Error('INITIAL_ADMIN_PASSWORD is required for first production bootstrap')
  const evaluationId = 'eval_demo'
  const evaluationCode = `PJ${randomDigits(4)}`
  const inviteLinkCode = randomDigits(8)
  const verifyCode = randomDigits(6)
  const codeHash = await hashVerifyCode(evaluationId, verifyCode)
  const evaluatorHash = await sha256(`evaluator:${codeHash}`)
  const employees = [
    { id:'emp_001', name:'张三', gender:'male', departmentId:'dep_rd', teamId:'team_rd', position:'研发工程师', status:'active' },
    { id:'emp_002', name:'李四', gender:'female', departmentId:'dep_rd', teamId:'team_rd', position:'前端工程师', status:'active' },
    { id:'emp_003', name:'王敏', gender:'female', departmentId:'dep_rd', teamId:'team_rd', position:'产品经理', status:'active' },
    { id:'emp_004', name:'赵强', gender:'male', departmentId:'dep_rd', teamId:'team_rd', position:'测试工程师', status:'active' },
    { id:'emp_005', name:'陈晓', gender:'female', departmentId:'dep_rd', teamId:'team_rd', position:'UI 设计师', status:'active' }
  ]
  const salt = 'review_admin_v1'
  return {
    version: 4,
    createdAt: now,
    users: [{
      id:'user_admin', username:'admin', displayName:'系统管理员', role:'admin',
      salt, passwordHash:await hashPassword(initialAdminPassword, salt), passwordAlgorithm:PASSWORD_ALGORITHM,
      passwordIterations:PASSWORD_ITERATIONS, mustChangePassword:true, status:'active',
      teamId:'', departmentId:'', employeeId:'', createdAt:now, updatedAt:now
    }],
    departments: [
      { id:'dep_rd', name:'技术研发部', leader:'刘主管', sort:1, status:'active' },
      { id:'dep_product', name:'产品中心', leader:'周主管', sort:2, status:'active' }
    ],
    teams: [
      { id:'team_rd', name:'研发团队', departmentId:'dep_rd', leader:'张三', sort:1, status:'active' },
      { id:'team_pm', name:'产品团队', departmentId:'dep_product', leader:'王敏', sort:2, status:'active' }
    ],
    employees,
    memberTags: [],
    periods: [{ id:'period_demo', name:'2026年第三季度', startTime:'2026-07-01T00:00:00+08:00', endTime:'2026-09-30T23:59:59+08:00', status:'active', anonymous:true, allowRepeat:false, allowModify:false, createdAt:now }],
    evaluationCodes: [{
      id:evaluationId, code:evaluationCode, linkCode:inviteLinkCode, name:'研发团队匿名反馈', periodId:'period_demo',
      teamId:'team_rd', departmentId:'dep_rd', status:'active',
      startTime:'2026-07-01T00:00:00+08:00', endTime:'2026-09-30T23:59:59+08:00',
      rules:copyJson(DEFAULT_RULES), rounding:DEFAULT_ROUNDING, participantMode:'selected',
      participantEmployeeIds:['emp_001'], targetType:'employee', targetMode:'selected',
      targetEmployeeIds:employees.map((x) => x.id), targetTeamIds:[],
      excludeSelf:true, createdAt:now, updatedAt:now
    }],
    verifyCodes: [{
      id:'verify_demo', evaluationCodeId:evaluationId, codeHash,
      code:verifyCode, codeFingerprint:await globalCodeFingerprint(verifyCode), codeMask:verifyCode, suffix:verifyCode.slice(-2),
      evaluatorHash, participantEmployeeId:'emp_001', expected:employees.length - 1, submitted:0,
      remaining:employees.length - 1, status:'unused', firstUsedAt:null, completedAt:null, createdAt:now
    }],
    tasks: employees.filter((x) => x.id !== 'emp_001').map((employee,index) => ({
      id:`task_demo_${index+1}`, evaluationCodeId:evaluationId, verifyCodeId:'verify_demo', evaluatorHash,
      targetType:'employee', targetId:employee.id, targetEmployeeId:employee.id, status:'pending', submittedAt:null
    })),
    scores: [],
    timedInvites: [],
    settings: { systemName:'和光镜鉴', publicSessionMinutes:120, logRetentionDays:90 },
    logs: []
  }
}

function syncVerifyProgress(db, verify) {
  const tasks = db.tasks.filter((x) => x.verifyCodeId === verify.id)
  verify.expected = tasks.length
  verify.submitted = tasks.filter((x) => x.status === 'submitted').length
  verify.remaining = Math.max(0, verify.expected - verify.submitted)
  if (verify.expected > 0 && verify.remaining === 0) {
    verify.status = 'completed'
    verify.completedAt ||= nowText()
  } else if (verify.status === 'completed' && verify.remaining > 0) {
    verify.status = verify.firstUsedAt ? 'in_progress' : 'unused'
    verify.completedAt = null
  }
  return verify
}

function expireTimedInvites(db) {
  const now = Date.now()
  for (const invite of db.timedInvites || []) {
    const verify = db.verifyCodes.find((x) => x.id === invite.verifyCodeId)
    if (verify) syncVerifyProgress(db, verify)
    if (verify?.remaining === 0 && invite.status !== 'completed') {
      invite.status = 'completed'
      invite.completedAt ||= nowText()
    } else if (invite.expiresAt && parseTime(invite.expiresAt) <= now && invite.status !== 'completed') {
      invite.status = 'expired'
    }
  }
}

function timedInviteView(db, invite) {
  const verify = db.verifyCodes.find((item) => item.id === invite.verifyCodeId)
  if (verify) syncVerifyProgress(db,verify)
  const tasks = db.tasks.filter((task) => task.verifyCodeId === invite.verifyCodeId)
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((task) => task.status === 'submitted').length
  const remainingTasks = Math.max(0,totalTasks-completedTasks)
  const expired = Boolean(invite.expiresAt && parseTime(invite.expiresAt) <= Date.now())
  const status = totalTasks > 0 && completedTasks === totalTasks
    ? 'completed'
    : expired
      ? 'expired'
      : invite.firstOpenedAt
        ? 'in_progress'
        : 'unused'
  return {
    ...invite,status,statusLabel:status==='completed'?'已完成':status==='expired'?'已过期':status==='in_progress'?'评价中':'未开始',
    totalTasks,completedTasks,remainingTasks,allCompleted:totalTasks > 0 && remainingTasks === 0
  }
}

function migrateDatabase(db) {
  const arrays = ['users','admins','departments','teams','employees','memberTags','periods','evaluationCodes','verifyCodes','tasks','scores','timedInvites','logs']
  for (const key of arrays) if (!Array.isArray(db[key])) db[key] = []
  if (!db.users.length && db.admins.length) {
    db.users = db.admins.map((item) => ({
      ...item,
      id: item.id || randomId('user'),
      displayName: item.displayName || item.username || '管理员',
      role: item.role || 'admin',
      teamId: item.teamId || '', departmentId: item.departmentId || '', employeeId: item.employeeId || ''
    }))
  }
  db.admins = []
  db.settings ||= { systemName:'和光镜鉴', publicSessionMinutes:120, logRetentionDays:90 }
  for (const user of db.users) {
    user.role ||= 'admin'
    user.displayName ||= user.username
    user.status ||= 'active'
    user.teamId ||= ''
    user.departmentId ||= ''
    user.employeeId ||= ''
    user.passwordAlgorithm ||= 'legacy-sha256'
    if (user.passwordAlgorithm === PASSWORD_ALGORITHM) user.passwordIterations ||= PASSWORD_ITERATIONS
    if (user.username === 'admin' && user.salt === 'review_admin_v1') user.mustChangePassword = true
    user.mustChangePassword = Boolean(user.mustChangePassword)
  }
  const seenTagIds = new Set()
  const seenTagNames = new Set()
  db.memberTags = db.memberTags.filter((tag) => {
    tag.id = normalize(tag.id) || randomId('tag')
    tag.name = normalize(tag.name).replace(/\s+/g,' ')
    const key = tag.name.toLocaleLowerCase('zh-CN')
    if (!tag.name || tag.name.length > 20 || seenTagIds.has(tag.id) || seenTagNames.has(key)) return false
    seenTagIds.add(tag.id)
    seenTagNames.add(key)
    tag.createdAt ||= nowText()
    tag.updatedAt ||= tag.createdAt
    return true
  })
  for (const employee of db.employees) {
    delete employee.employeeNo
    delete employee.phone
    employee.tagIds = resolveMemberTagIds(db,employee.tagIds)
  }
  for (const evaluation of db.evaluationCodes) {
    evaluation.rules = Array.isArray(evaluation.rules) && evaluation.rules.length ? evaluation.rules : copyJson(DEFAULT_RULES)
    evaluation.rules = evaluation.rules.map((rule) => ({...rule,operation:rule.operation === 'subtract' ? 'subtract' : 'add'}))
    evaluation.rounding ||= DEFAULT_ROUNDING
    evaluation.participantMode ||= 'quantity'
    evaluation.excludeSelf = Boolean(evaluation.excludeSelf)
    evaluation.targetType = evaluation.targetType === 'team' ? 'team' : 'employee'
    const teamEmployeeIds = db.employees.filter((x) => x.teamId === evaluation.teamId && x.status === 'active').map((x) => x.id)
    if (!Array.isArray(evaluation.targetEmployeeIds)) evaluation.targetEmployeeIds = []
    if (evaluation.targetType === 'employee' && !evaluation.targetEmployeeIds.length) evaluation.targetEmployeeIds = teamEmployeeIds
    if (!Array.isArray(evaluation.targetTeamIds)) evaluation.targetTeamIds = []
    if (!Array.isArray(evaluation.participantEmployeeIds)) evaluation.participantEmployeeIds = []
    evaluation.targetMode ||= 'selected'
    if (!['team','department','custom'].includes(evaluation.employeeTargetScope)) {
      evaluation.employeeTargetScope = evaluation.targetMode === 'selected' ? 'custom' : 'team'
    }
    evaluation.targetTeamId ||= evaluation.teamId
    evaluation.targetDepartmentId ||= evaluation.departmentId
    evaluation.linkCode ||= generateUniqueLinkCode(db)
  }
  const evaluationById = new Map(db.evaluationCodes.map((evaluation) => [evaluation.id,evaluation]))
  for (const task of db.tasks) {
    const evaluation = evaluationById.get(task.evaluationCodeId)
    task.targetType = task.targetType === 'team' || task.targetTeamId ? 'team' : evaluation?.targetType === 'team' ? 'team' : 'employee'
    task.targetId = String(task.targetId || (task.targetType === 'team' ? task.targetTeamId : task.targetEmployeeId) || '')
    if (task.targetType === 'team') {
      task.targetTeamId = task.targetId
      delete task.targetEmployeeId
    } else {
      task.targetEmployeeId = task.targetId
      delete task.targetTeamId
    }
  }
  for (const score of db.scores) {
    const task = db.tasks.find((item) => item.id === score.taskId)
    score.targetType = score.targetType === 'team' || score.targetTeamId ? 'team' : task?.targetType === 'team' ? 'team' : 'employee'
    score.targetId = String(score.targetId || (score.targetType === 'team' ? score.targetTeamId : score.targetEmployeeId) || task?.targetId || '')
    if (score.targetType === 'team') {
      score.targetTeamId = score.targetId
      delete score.targetEmployeeId
    } else {
      score.targetEmployeeId = score.targetId
      delete score.targetTeamId
    }
  }
  for (const verify of db.verifyCodes) {
    verify.codeMask = verify.code || verify.codeMask || (verify.suffix ? `****${String(verify.suffix).slice(-2)}` : '******')
    verify.participantEmployeeId ||= ''
    syncVerifyProgress(db, verify)
  }
  for (const invite of db.timedInvites) {
    invite.status ||= 'unused'
    invite.createdAt ||= nowText()
    invite.firstOpenedAt ||= null
    invite.expiresAt ||= null
    invite.completedAt ||= null
  }
  db.version = 4
  return db
}

async function loadDatabase(context) {
  const kv = getKvBinding(context)
  if (kv) {
    let database
    try {
      database = await kv.get(DATABASE_KEY, { type: 'json' })
    } catch (error) {
      throw httpError('KV 读取失败，请检查 KV 命名空间绑定和 Functions 权限',503,'KV_READ_FAILED')
    }
    if (typeof database === 'string') {
      try { database = JSON.parse(database) }
      catch { throw httpError('KV 中的系统数据格式无效，请从备份恢复',500,'KV_DATA_INVALID') }
    }
    if (!database) {
      try {
        database = await createSeedDatabase(context)
        await kv.put(DATABASE_KEY, JSON.stringify(database))
      } catch (error) {
        if (Number(error?.status)) throw error
        throw httpError('首次初始化失败，请确认 INITIAL_ADMIN_PASSWORD 已在 Functions 环境变量中配置',503,'BOOTSTRAP_FAILED')
      }
    }
    if (typeof database !== 'object' || Array.isArray(database)) throw httpError('KV 中的系统数据结构无效，请从备份恢复',500,'KV_DATA_INVALID')
    return migrateDatabase(database)
  }
  if (getEnv(context, 'APP_ENV', 'development') === 'production') throw httpError('KV 未绑定，请在 EdgeOne Functions 中绑定 EVALUATION_KV',503,'KV_NOT_BOUND')
  if (!memoryDatabase) memoryDatabase = await createSeedDatabase(context)
  return migrateDatabase(copyJson(memoryDatabase))
}
async function saveDatabase(context, database) {
  database.updatedAt = nowText()
  const kv = getKvBinding(context)
  if (kv) {
    try { await kv.put(DATABASE_KEY, JSON.stringify(database)) }
    catch { throw httpError('KV 写入失败，请检查 KV 命名空间绑定和 Functions 权限',503,'KV_WRITE_FAILED') }
  } else if (getEnv(context, 'APP_ENV', 'development') === 'production') {
    throw httpError('KV 未绑定，请在 EdgeOne Functions 中绑定 EVALUATION_KV',503,'KV_NOT_BOUND')
  } else memoryDatabase = copyJson(database)
  return database
}

const ADMIN_COOKIE_NAME = 'lumirror_admin'
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
function json(data,status=200,extraHeaders = {}) {
  return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extraHeaders}})
}
const ok = (data,message) => json({success:true,data,...(message?{message}:{})})
const fail = (message,status=400,code) => json({success:false,message,...(code?{code}:{})},status)
const authHeader = (request) => request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || ''
function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || ''
  const item = cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.slice(name.length + 1)) : ''
}
function adminTokenFromRequest(request) {
  return authHeader(request) || cookieValue(request,ADMIN_COOKIE_NAME)
}
function cookieSecure(context) {
  const forced = getEnv(context,'SESSION_COOKIE_SECURE','')
  if (forced) return forced === 'true'
  return getEnv(context,'APP_ENV','development') === 'production' || new URL(context.request.url).protocol === 'https:'
}
function adminCookie(context, token, maxAgeSeconds) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1,Number(maxAgeSeconds) || 1)}`
  ]
  if (cookieSecure(context)) parts.push('Secure')
  return parts.join('; ')
}
function clearAdminCookie(context) {
  return adminCookie(context,'expired',1).replace('Max-Age=1','Max-Age=0')
}
function corsOrigin(context) {
  const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/,'')
  const origin = normalizeOrigin(context?.request?.headers?.get('origin'))
  const allowlist = getEnv(context,'ALLOWED_ORIGINS','').split(',').map(normalizeOrigin).filter(Boolean)
  if (!origin) return ''
  if (allowlist.length) return allowlist.includes(origin) ? origin : ''
  return getEnv(context,'APP_ENV','development') === 'production' ? '' : origin
}
function withCors(response, context) {
  const headers = new Headers(response.headers)
  headers.set('x-request-id',requestId(context))
  const origin = corsOrigin(context)
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.set('vary', 'Origin')
  } else {
    headers.delete('access-control-allow-origin')
    headers.delete('access-control-allow-credentials')
  }
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers })
}
function httpError(message, status = 400, code = 'BAD_REQUEST') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}
function logInternalError(context, error) {
  console.error(JSON.stringify({
    timestamp:nowText(),requestId:requestId(context),level:'error',errorType:error?.name || 'Error',
    errorMessage:String(error?.message || 'Unknown server error').slice(0,240)
  }))
}
const bodyJson = async (request) => {
  const length = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw httpError('请求体过大',413,'PAYLOAD_TOO_LARGE')
  try {
    const text = await request.text()
    if (encoder.encode(text).length > MAX_BODY_BYTES) throw httpError('请求体过大',413,'PAYLOAD_TOO_LARGE')
    return text.trim() ? JSON.parse(text) : {}
  } catch (error) {
    if (error?.code === 'PAYLOAD_TOO_LARGE') throw error
    return {}
  }
}
function clientKey(request) {
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anonymous'
}
function checkBodySize(request) {
  const length = Number(request.headers.get('content-length') || 0)
  return Number.isFinite(length) && length <= MAX_BODY_BYTES
}
function requireAdminRequestHeader(request, path, method) {
  if (!path.startsWith('/admin/') || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null
  if (path === '/admin/login') return null
  if (authHeader(request)) return null
  return request.headers.get('x-lumirror-request') === 'fetch' ? null : fail('缺少后台安全请求头',403,'CSRF_REQUIRED')
}
function rateLimited(request, bucket, limit, windowMs) {
  const now = Date.now()
  const key = `${bucket}:${clientKey(request)}`
  const current = rateBuckets.get(key)
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key,{count:1,resetAt:now + windowMs})
    return false
  }
  current.count += 1
  return current.count > limit
}
const adminSecret = (context) => getEnv(context,'ADMIN_TOKEN_SECRET',getEnv(context,'APP_ENV','development')==='production'?'':'local-development-admin-secret')
const evaluatorSecret = (context) => getEnv(context,'PUBLIC_TOKEN_SECRET',getEnv(context,'APP_ENV','development')==='production'?'':'local-development-public-secret')
function ensureSecrets(context) {
  if (!adminSecret(context) || !evaluatorSecret(context)) {
    throw httpError('后台密钥未配置，请设置 ADMIN_TOKEN_SECRET 和 PUBLIC_TOKEN_SECRET',503,'TOKEN_SECRETS_MISSING')
  }
}
async function requireAdmin(context) {
  const payload = await verifyToken(adminTokenFromRequest(context.request),adminSecret(context))
  return payload?.kind === 'backend' ? payload : null
}
async function requirePublic(context) {
  const payload = await verifyToken(authHeader(context.request),evaluatorSecret(context))
  return payload?.role === 'evaluator' ? payload : null
}
function hasPermission(session, permission) {
  const list = ROLE_PERMISSIONS[session?.role] || []
  return list.includes('*') || list.includes(permission)
}
function requirePermission(session, permission) {
  return hasPermission(session, permission) ? null : fail('当前账号没有此操作权限',403,'FORBIDDEN')
}
function roleView(user) {
  return {
    id:user.id, username:user.username, displayName:user.displayName, role:user.role,
    roleLabel:ROLE_LABELS[user.role] || user.role, status:user.status,
    teamId:user.teamId || '', departmentId:user.departmentId || '', employeeId:user.employeeId || '',
    permissions:ROLE_PERMISSIONS[user.role] || [],
    mustChangePassword:Boolean(user.mustChangePassword)
  }
}

function resolveUserScope(db, role, input) {
  if (role === 'admin') return { teamId:'', departmentId:'', employeeId:'' }
  if (role === 'leader') {
    const department = db.departments.find((x) => x.id === input.departmentId)
    if (!department) throw new Error('领导账号必须绑定有效部门')
    return { teamId:'', departmentId:department.id, employeeId:'' }
  }
  if (role === 'team_leader') {
    const team = db.teams.find((x) => x.id === input.teamId)
    if (!team) throw new Error('团队长账号必须绑定有效团队')
    return { teamId:team.id, departmentId:team.departmentId, employeeId:'' }
  }
  if (role === 'member') {
    const employee = db.employees.find((x) => x.id === input.employeeId && x.status === 'active')
    if (!employee) throw new Error('成员账号必须绑定有效成员')
    return { teamId:employee.teamId, departmentId:employee.departmentId, employeeId:employee.id }
  }
  throw new Error('角色无效')
}

function parseTime(value) {
  if (!value) return NaN
  const text = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T')
  return new Date(text).getTime()
}
function activityStatus(evaluation) {
  if (evaluation.status === 'disabled' || evaluation.status === 'archived') return evaluation.status
  const now = Date.now(), start = parseTime(evaluation.startTime), end = parseTime(evaluation.endTime)
  if (Number.isFinite(start) && now < start) return 'upcoming'
  if (Number.isFinite(end) && now > end) return 'ended'
  return 'active'
}
function evaluationHasEnded(evaluation) {
  const end = parseTime(evaluation?.endTime)
  return Number.isFinite(end) && Date.now() > end
}
function ensureEvaluationMutable(evaluation, action = '执行该操作') {
  if (evaluation?.status === 'archived') throw httpError(`已归档活动为只读状态，不能${action}`,409,'EVALUATION_ARCHIVED')
}
function enrichEmployees(db) {
  const departments = new Map(db.departments.map((x) => [x.id,x]))
  const teams = new Map(db.teams.map((x) => [x.id,x]))
  const tags = new Map((db.memberTags || []).map((tag) => [tag.id,tag]))
  return db.employees.map((e) => ({
    ...e,
    departmentName:departments.get(e.departmentId)?.name || '',
    teamName:teams.get(e.teamId)?.name || '',
    tagIds:resolveMemberTagIds(db,e.tagIds),
    tags:resolveMemberTagIds(db,e.tagIds).map((id) => tags.get(id)).filter(Boolean)
  }))
}
function computeTotal(scores,rules,rounding) {
  const enabled = rules.filter((x) => x.enabled)
  if (!enabled.length) return null
  for (const rule of enabled) {
    const value = Number(scores[rule.id])
    if (!Number.isInteger(value) || value < rule.min || value > rule.max) return null
  }
  const equalAverage = enabled.every((rule) => (rule.operation || 'add') === 'add' && Number(rule.weight) === 100)
  const netWeight = enabled.reduce((sum,rule) => sum + ((rule.operation || 'add') === 'subtract' ? -1 : 1) * Number(rule.weight),0)
  const value = equalAverage
    ? enabled.reduce((sum,rule) => sum + Number(scores[rule.id]), 0) / enabled.length
    : enabled.reduce((sum,rule) => sum + ((rule.operation || 'add') === 'subtract' ? -1 : 1) * Number(scores[rule.id]) * Number(rule.weight) / 100, 0)
  if (!equalAverage && netWeight !== 100) return null
  if (rounding === 'one_decimal') return Math.round(value * 10) / 10
  if (rounding === 'floor') return Math.floor(value)
  return Math.round(value)
}

function prepareScoreRules(inputRules) {
  if (!Array.isArray(inputRules) || inputRules.length < 1 || inputRules.length > 12) throw httpError('评分维度数量必须为 1-12 个')
  const rules = inputRules.map((item,index) => ({
    id:normalize(item.id) || `dimension_${index+1}`,
    name:normalize(item.name),
    min:Number(item.min),max:Number(item.max),weight:Number(item.weight),
    operation:item.operation === 'subtract' ? 'subtract' : 'add',enabled:Boolean(item.enabled)
  }))
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length || rules.some((rule) => !/^[A-Za-z0-9_-]{1,48}$/.test(rule.id))) throw httpError('评分维度标识无效或重复')
  if (rules.some((rule) => !rule.name || rule.name.length > 30)) throw httpError('评分维度名称不能为空且不能超过 30 个字符')
  if (rules.some((rule) => !Number.isInteger(rule.min)||!Number.isInteger(rule.max)||rule.min<0||rule.max>99||rule.min>=rule.max)) throw httpError('评分范围必须是 0-99 内递增的整数')
  if (rules.some((rule) => !Number.isInteger(rule.weight)||rule.weight<0||rule.weight>100)) throw httpError('计入比例必须是 0-100 的整数')
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) throw httpError('至少启用 1 个评分维度')
  const equalAverage = enabled.every((rule) => rule.operation === 'add' && rule.weight === 100)
  const netWeight = enabled.reduce((sum,rule) => sum + (rule.operation === 'subtract' ? -1 : 1) * rule.weight,0)
  if (!equalAverage && netWeight !== 100) throw httpError('启用维度的净计入比例必须为 100%，或全部使用 100% 等权平均')
  return rules
}
function activityView(db,evaluation) {
  const verifies = db.verifyCodes.filter((x) => x.evaluationCodeId === evaluation.id)
  verifies.forEach((x) => syncVerifyProgress(db,x))
  const completed = verifies.filter((x) => x.status === 'completed').length
  const taskCount = db.tasks.filter((x) => x.evaluationCodeId === evaluation.id).length
  const targetType = evaluation.targetType === 'team' ? 'team' : 'employee'
  const targetCount = targetType === 'team'
    ? (Array.isArray(evaluation.targetTeamIds) ? evaluation.targetTeamIds.length : 0)
    : (Array.isArray(evaluation.targetEmployeeIds) ? evaluation.targetEmployeeIds.length : 0)
  return {
    ...evaluation,
    status:activityStatus(evaluation),
    lifecycleStatus:evaluation.status,
    periodName:db.periods.find((p) => p.id === evaluation.periodId)?.name || '',
    teamName:db.teams.find((t) => t.id === evaluation.teamId)?.name || '',
    participantCount:verifies.length,
    completedParticipants:completed,
    pendingParticipants:Math.max(0,verifies.length-completed),
    completionRate:verifies.length ? Math.round(completed / verifies.length * 100) : 0,
    taskCount,
    targetType,targetTypeLabel:targetType === 'team' ? '团队' : '成员',targetCount
  }
}
function visibleTeamIds(db, session) {
  if (session.role === 'admin') return new Set(db.teams.map((x) => x.id))
  if (session.role === 'team_leader') return new Set(session.teamId ? [session.teamId] : [])
  if (session.role === 'leader') return new Set(db.teams.filter((x) => x.departmentId === session.departmentId).map((x) => x.id))
  if (session.role === 'member') {
    const employee = db.employees.find((x) => x.id === session.employeeId)
    return new Set(employee?.teamId ? [employee.teamId] : session.teamId ? [session.teamId] : [])
  }
  return new Set()
}
function scopeEmployees(db, session, employees = enrichEmployees(db)) {
  const teamIds = visibleTeamIds(db, session)
  return employees.filter((x) => teamIds.has(x.teamId))
}
function scopeEvaluations(db, session, evaluations = db.evaluationCodes) {
  const teamIds = visibleTeamIds(db, session)
  return evaluations.filter((x) => teamIds.has(x.teamId))
}
function canAccessEvaluation(db, session, evaluation) {
  return Boolean(evaluation && visibleTeamIds(db,session).has(evaluation.teamId))
}
function canWriteTeam(session, teamId) {
  return session.role === 'admin' || (session.role === 'team_leader' && session.teamId === teamId)
}
function uniqueStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))] }
function evaluationTargetType(evaluation) { return evaluation?.targetType === 'team' ? 'team' : 'employee' }
function targetReference(targetType,targetId) {
  return targetType === 'team'
    ? {targetType:'team',targetId,targetTeamId:targetId}
    : {targetType:'employee',targetId,targetEmployeeId:targetId}
}
function itemTargetType(item,evaluation) {
  return item?.targetType === 'team' || item?.targetTeamId ? 'team' : evaluationTargetType(evaluation)
}
function itemTargetId(item,evaluation) {
  const targetType = itemTargetType(item,evaluation)
  return String(item?.targetId || (targetType === 'team' ? item?.targetTeamId : item?.targetEmployeeId) || '')
}
function targetKey(targetType,targetId) { return `${targetType}:${targetId}` }
function getEvaluationTargets(db, evaluation) {
  if (evaluationTargetType(evaluation) === 'team') {
    const ids = new Set(uniqueStrings(evaluation.targetTeamIds))
    return db.teams.filter((team) => ids.has(team.id) && team.status === 'active').map((team) => ({
      ...team,targetType:'team',targetId:team.id,targetTeamId:team.id,teamName:team.name,
      departmentName:db.departments.find((department) => department.id === team.departmentId)?.name || '',
      memberCount:db.employees.filter((employee) => employee.teamId === team.id && employee.status === 'active').length
    }))
  }
  const ids = new Set(uniqueStrings(evaluation.targetEmployeeIds))
  return enrichEmployees(db).filter((employee) => ids.has(employee.id) && employee.status === 'active').map((employee) => ({
    ...employee,targetType:'employee',targetId:employee.id,targetEmployeeId:employee.id
  }))
}
function getParticipantEmployees(db, evaluation) {
  const ids = new Set(uniqueStrings(evaluation.participantEmployeeIds))
  return db.employees.filter((x) => ids.has(x.id) && x.status === 'active')
}
async function addVerifyCodesAndTasks(db,evaluation,options = {}) {
  const targets = getEvaluationTargets(db,evaluation)
  if (!targets.length) throw new Error('评价对象不能为空')
  const participantEmployeeIds = uniqueStrings(options.participantEmployeeIds)
  const quantity = Number(options.count || 0)
  if (participantEmployeeIds.length) {
    const alreadyBound = new Set(db.verifyCodes.filter((x) => x.evaluationCodeId === evaluation.id && x.participantEmployeeId).map((x) => x.participantEmployeeId))
    const duplicated = participantEmployeeIds.find((id) => alreadyBound.has(id))
    if (duplicated) {
      const employee = db.employees.find((x) => x.id === duplicated)
      throw new Error(`${employee?.name || '所选成员'}在该活动中已绑定邀请码`)
    }
  }
  const participants = participantEmployeeIds.length
    ? participantEmployeeIds.map((id) => db.employees.find((x) => x.id === id && x.status === 'active')).filter(Boolean)
    : Array.from({ length: quantity }, () => null)
  if (!participants.length) throw new Error('至少需要生成 1 个邀请码')
  for (const participant of participants) {
    if (participant && evaluationTargetType(evaluation) === 'employee' && evaluation.excludeSelf && targets.every((target) => target.id === participant.id)) {
      throw new Error(`${participant.name}没有可评价对象，请调整评价范围或关闭“排除自评”`)
    }
  }
  const codes = []
  let taskCount = 0
  for (const participant of participants) {
    const generated = await generateVerifyCode(db)
    const id = randomId('verify')
    const codeHash = await hashVerifyCode(evaluation.id,generated.code)
    const evaluatorHash = await sha256(`evaluator:${codeHash}`)
    const participantEmployeeId = participant?.id || ''
    const participantTargets = targets.filter((target) => !(evaluationTargetType(evaluation) === 'employee' && evaluation.excludeSelf && participantEmployeeId && target.id === participantEmployeeId))
    const verify = {
      id, evaluationCodeId:evaluation.id, codeHash, codeFingerprint:generated.fingerprint,
      code:generated.code, codeMask:generated.code, suffix:generated.code.slice(-2), evaluatorHash,
      participantEmployeeId, expected:participantTargets.length, submitted:0, remaining:participantTargets.length,
      status:'unused', firstUsedAt:null, lastUsedAt:null, completedAt:null, createdAt:nowText()
    }
    db.verifyCodes.push(verify)
    for (const target of participantTargets) {
      db.tasks.push({
        id:randomId('task'), evaluationCodeId:evaluation.id, verifyCodeId:id, evaluatorHash,
        ...targetReference(evaluationTargetType(evaluation),target.id),status:'pending', submittedAt:null
      })
      taskCount++
    }
    codes.push({ id, code:generated.code, employeeId:participantEmployeeId, employeeName:participant?.name || '' })
  }
  evaluation.participantEmployeeIds = uniqueStrings([
    ...(evaluation.participantEmployeeIds || []),
    ...participants.filter(Boolean).map((x) => x.id)
  ])
  return { codes, taskCount, targetCount:targets.length }
}

function mutateUserStatus(db, currentUser, id, status) {
  if (!['active','inactive'].includes(status)) throw httpError('账号状态无效')
  const item = db.users.find((x) => x.id === id)
  if (!item) throw httpError('账号不存在',404)
  if (item.id === currentUser.id && status === 'inactive') throw httpError('不能停用当前登录账号',409)
  const candidate = { ...item, status, updatedAt:nowText() }
  const activeAdminCount = db.users.filter((x) => x.id !== item.id && x.role === 'admin' && x.status === 'active').length + (candidate.role === 'admin' && candidate.status === 'active' ? 1 : 0)
  if (activeAdminCount < 1) throw httpError('系统必须保留至少一个启用管理员',409)
  Object.assign(item,candidate)
}

function deleteUser(db, currentUser, id) {
  const item = db.users.find((x) => x.id === id)
  if (!item) throw httpError('账号不存在',404)
  if (item.id === currentUser.id) throw httpError('不能删除当前登录账号',409)
  if (db.users.length <= 1 || db.users.filter((x) => x.id !== item.id).length < 1) throw httpError('至少保留一个后台账号',409)
  if (item.role === 'admin' && item.status === 'active' && db.users.filter((x) => x.id !== item.id && x.role === 'admin' && x.status === 'active').length < 1) throw httpError('不能删除最后一个启用管理员',409)
  db.users = db.users.filter((x) => x.id !== item.id)
}

function mutateEmployeeStatus(db, session, id, status) {
  if (!['active','inactive'].includes(status)) throw httpError('成员状态无效')
  const employee = db.employees.find((x) => x.id === id)
  if (!employee) throw httpError('员工不存在',404)
  if (!visibleTeamIds(db,session).has(employee.teamId)) throw httpError('无权编辑该员工',403)
  employee.status = status
  employee.updatedAt = nowText()
}

function deleteEmployee(db, session, id) {
  const employee = db.employees.find((x) => x.id === id)
  if (!employee) throw httpError('员工不存在',404)
  if (!visibleTeamIds(db,session).has(employee.teamId)) throw httpError('无权删除该员工',403)
  if (db.scores.some((x) => itemTargetType(x) === 'employee' && itemTargetId(x) === employee.id)) throw httpError('该员工已有历史评分，不能删除，请改为停用',409)
  if (db.verifyCodes.some((x) => x.participantEmployeeId === employee.id && x.submitted > 0)) throw httpError('该员工已有评价提交记录，不能删除，请改为停用',409)
  db.employees = db.employees.filter((x) => x.id !== employee.id)
  db.tasks = db.tasks.filter((x) => !(itemTargetType(x) === 'employee' && itemTargetId(x) === employee.id))
  db.verifyCodes.forEach((x) => syncVerifyProgress(db,x))
  db.users.forEach((x) => { if (x.employeeId === employee.id) x.employeeId = '' })
  db.evaluationCodes.forEach((x) => {
    x.targetEmployeeIds = (x.targetEmployeeIds || []).filter((itemId) => itemId !== employee.id)
    x.participantEmployeeIds = (x.participantEmployeeIds || []).filter((itemId) => itemId !== employee.id)
  })
}

function mutateOrgStatus(db, kind, id, status) {
  if (!['active','inactive'].includes(status)) throw httpError('组织状态无效')
  const item = db[kind]?.find((x) => x.id === id)
  if (!item) throw httpError('记录不存在',404)
  item.status = status
  item.updatedAt = nowText()
}

function deleteOrg(db, kind, id) {
  const item = db[kind]?.find((x) => x.id === id)
  if (!item) throw httpError('记录不存在',404)
  if (kind === 'departments') {
    if (db.teams.some((x) => x.departmentId === id) || db.employees.some((x) => x.departmentId === id) || db.users.some((x) => x.departmentId === id)) throw httpError('该部门仍被团队、成员或账号使用，不能删除',409)
  } else {
    if (db.employees.some((x) => x.teamId === id) || db.evaluationCodes.some((x) => x.teamId === id || (x.targetTeamIds || []).includes(id)) || db.users.some((x) => x.teamId === id) || db.tasks.some((x) => itemTargetType(x) === 'team' && itemTargetId(x) === id) || db.scores.some((x) => itemTargetType(x) === 'team' && itemTargetId(x) === id)) throw httpError('该团队仍被成员、活动、评价任务、评分或账号使用，不能删除',409)
  }
  db[kind] = db[kind].filter((x) => x.id !== id)
}

function mutatePeriodStatus(db, id, status) {
  if (!['active','inactive'].includes(status)) throw httpError('评价周期状态无效')
  const item = db.periods.find((x) => x.id === id)
  if (!item) throw httpError('周期不存在',404)
  item.status = status
  item.updatedAt = nowText()
}

function deletePeriod(db, id) {
  const item = db.periods.find((x) => x.id === id)
  if (!item) throw httpError('周期不存在',404)
  if (db.evaluationCodes.some((x) => x.periodId === id)) throw httpError('该周期已被评价活动使用，不能删除',409)
  db.periods = db.periods.filter((x) => x.id !== id)
}

function mutateEvaluationStatus(db, session, id, status) {
  if (!['active','disabled','archived'].includes(status)) throw httpError('活动状态无效')
  const evaluation = db.evaluationCodes.find((x) => x.id === id)
  if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) throw httpError('评价活动不存在或无权编辑',404)
  const previousStatus = evaluation.status
  if (status === 'archived' && previousStatus !== 'archived') {
    if (!evaluationHasEnded(evaluation)) throw httpError('只有已经结束的评价活动可以归档',409,'EVALUATION_NOT_ENDED')
    appendLog(db,session,'evaluation.archive',{evaluationId:evaluation.id,name:evaluation.name})
  } else if (previousStatus === 'archived' && status !== 'active') {
    throw httpError('已归档活动只能先恢复归档',409,'EVALUATION_ARCHIVED')
  } else if (previousStatus === 'archived' && status === 'active') {
    appendLog(db,session,'evaluation.unarchive',{evaluationId:evaluation.id,name:evaluation.name})
  }
  evaluation.status = status
  evaluation.updatedAt = nowText()
}

function deleteEvaluation(db, session, id) {
  const evaluation = db.evaluationCodes.find((x) => x.id === id)
  if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) throw httpError('评价活动不存在或无权删除',404)
  ensureEvaluationMutable(evaluation,'删除')
  const verifyIds = new Set(db.verifyCodes.filter((x) => x.evaluationCodeId === evaluation.id).map((x) => x.id))
  db.tasks = db.tasks.filter((x) => x.evaluationCodeId !== evaluation.id && !verifyIds.has(x.verifyCodeId))
  db.verifyCodes = db.verifyCodes.filter((x) => x.evaluationCodeId !== evaluation.id)
  db.timedInvites = db.timedInvites.filter((x) => x.evaluationCodeId !== evaluation.id)
  db.scores = db.scores.filter((x) => x.evaluationCodeId !== evaluation.id)
  db.evaluationCodes = db.evaluationCodes.filter((x) => x.id !== evaluation.id)
}

function deleteVerifyCode(db, session, id) {
  const verify = db.verifyCodes.find((x) => x.id === id)
  const evaluation = db.evaluationCodes.find((x) => x.id === verify?.evaluationCodeId)
  if (!verify || !canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) throw httpError('邀请码不存在或无权删除',404)
  ensureEvaluationMutable(evaluation,'删除邀请码')
  if (db.tasks.some((x) => x.verifyCodeId === verify.id && x.status === 'submitted')) throw httpError('该邀请码已有提交记录，不能删除',409)
  db.tasks = db.tasks.filter((x) => x.verifyCodeId !== verify.id)
  db.timedInvites = db.timedInvites.filter((x) => x.verifyCodeId !== verify.id)
  db.verifyCodes = db.verifyCodes.filter((x) => x.id !== verify.id)
}

function deleteTask(db, session, id) {
  const task = db.tasks.find((x) => x.id === id)
  const evaluation = db.evaluationCodes.find((x) => x.id === task?.evaluationCodeId)
  if (!task || !canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) throw httpError('任务不存在或无权删除',404)
  ensureEvaluationMutable(evaluation,'删除任务')
  if (task.status === 'submitted' || db.scores.some((x) => x.taskId === task.id)) throw httpError('已提交任务不能删除',409)
  db.tasks = db.tasks.filter((x) => x.id !== task.id)
  const verify = db.verifyCodes.find((x) => x.id === task.verifyCodeId)
  if (verify) syncVerifyProgress(db,verify)
}

function sanitizeSettings(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError('设置数据无效')
  const next = { ...current }
  if (input.systemName !== undefined) {
    const systemName = normalize(input.systemName)
    if (!systemName || systemName.length > 40) throw httpError('系统名称需为 1-40 个字符')
    next.systemName = systemName
  }
  if (input.publicSessionMinutes !== undefined) {
    const minutes = Number(input.publicSessionMinutes)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw httpError('普通评价会话时长需为 5-240 分钟')
    next.publicSessionMinutes = minutes
  }
  if (input.logRetentionDays !== undefined) {
    const days = Number(input.logRetentionDays)
    if (!Number.isInteger(days) || days < 7 || days > 3650) throw httpError('日志保留天数需为 7-3650 天')
    next.logRetentionDays = days
  }
  return next
}

function publicSessionSeconds(context, db) {
  const minutes = Number(db.settings?.publicSessionMinutes)
  if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 240) return minutes * 60
  const fallback = Number(getEnv(context,'PUBLIC_SESSION_SECONDS','7200'))
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 7200
}
function timedInviteLifetimeSeconds(context) {
  const seconds = Number(getEnv(context,'TIMED_INVITE_SECONDS','300'))
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 300
}

function isPlainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function assertImportArray(data, key, max) {
  if (!Array.isArray(data[key])) throw httpError(`导入数据缺少 ${key} 数组`)
  if (data[key].length > max) throw httpError(`${key} 数量超过上限 ${max}`,413,'IMPORT_TOO_LARGE')
  for (const item of data[key]) {
    if (!isPlainObject(item) || !normalize(item.id)) throw httpError(`${key} 中存在无效记录`)
  }
}
function validateImportData(data) {
  if (!isPlainObject(data)) throw httpError('JSON 数据结构无效')
  const limits = {
    departments:1000, teams:1000, employees:5000, memberTags:1000, periods:1000, evaluationCodes:1000,
    verifyCodes:50000, tasks:200000, scores:200000, timedInvites:50000, logs:50000
  }
  for (const [key,max] of Object.entries(limits)) {
    if (data[key] === undefined && ['memberTags','timedInvites','logs'].includes(key)) data[key] = []
    assertImportArray(data,key,max)
  }
  if ((data.verifyCodes || []).some((x) => x.code === '[REDACTED]' || x.codeHash === '[HASH]' || x.codeFingerprint === '[HASH]')) {
    throw httpError('当前 JSON 已脱敏，不能作为可恢复数据导入')
  }
  const departmentIds = new Set(data.departments.map((x) => String(x.id)))
  const teamIds = new Set(data.teams.map((x) => String(x.id)))
  const employeeIds = new Set(data.employees.map((x) => String(x.id)))
  const memberTagIds = new Set(data.memberTags.map((x) => String(x.id)))
  const periodIds = new Set(data.periods.map((x) => String(x.id)))
  const evaluationIds = new Set(data.evaluationCodes.map((x) => String(x.id)))
  const verifyIds = new Set(data.verifyCodes.map((x) => String(x.id)))
  if (data.teams.some((x) => x.departmentId && !departmentIds.has(String(x.departmentId)))) throw httpError('团队所属部门不存在')
  if (data.employees.some((x) => !teamIds.has(String(x.teamId)) || !departmentIds.has(String(x.departmentId)))) throw httpError('成员所属部门或团队不存在')
  if (data.memberTags.some((x) => !normalize(x.name) || normalize(x.name).length > 20)) throw httpError('成员标签名称无效')
  if (new Set(data.memberTags.map((x) => normalize(x.name).toLocaleLowerCase('zh-CN'))).size !== data.memberTags.length) throw httpError('成员标签名称不能重复')
  if (data.employees.some((x) => uniqueStrings(x.tagIds).some((id) => !memberTagIds.has(id)))) throw httpError('成员关联的标签不存在')
  if (data.evaluationCodes.some((x) => !teamIds.has(String(x.teamId)) || !departmentIds.has(String(x.departmentId)) || !periodIds.has(String(x.periodId)))) throw httpError('评价活动关联的部门、团队或周期不存在')
  if (data.verifyCodes.some((x) => !evaluationIds.has(String(x.evaluationCodeId)))) throw httpError('邀请码关联的评价活动不存在')
  const validTarget = (item) => {
    const targetType = item.targetType === 'team' || item.targetTeamId ? 'team' : 'employee'
    const targetId = String(item.targetId || (targetType === 'team' ? item.targetTeamId : item.targetEmployeeId) || '')
    return targetType === 'team' ? teamIds.has(targetId) : employeeIds.has(targetId)
  }
  if (data.evaluationCodes.some((x) => x.targetType === 'team' && uniqueStrings(x.targetTeamIds).some((id) => !teamIds.has(id)))) throw httpError('评价活动关联的目标团队不存在')
  if (data.tasks.some((x) => !evaluationIds.has(String(x.evaluationCodeId)) || !verifyIds.has(String(x.verifyCodeId)) || !validTarget(x))) throw httpError('评价任务关联数据不存在')
  if (data.scores.some((x) => !evaluationIds.has(String(x.evaluationCodeId)) || !validTarget(x))) throw httpError('评分结果关联数据不存在')
  return data
}

function appendLog(db, session, action, detail = {}) {
  db.logs ||= []
  db.logs.push({
    id:randomId('log'),
    action,
    actorId:session?.userId || '',
    actorName:session?.username || '',
    role:session?.role || '',
    detail,
    createdAt:nowText()
  })
  if (db.logs.length > 5000) db.logs = db.logs.slice(-5000)
}

function cleanExport(db, { sensitive = false } = {}) {
  const output = copyJson(db)
  output.users = output.users.map((x) => ({
    ...x,
    passwordHash:sensitive ? x.passwordHash : '[REDACTED]',
    salt:sensitive ? x.salt : '[REDACTED]'
  }))
  if (!sensitive) {
    output.verifyCodes = output.verifyCodes.map((x) => ({
      ...x,
      code:'[REDACTED]',
      codeMask:'[REDACTED]',
      suffix:'[REDACTED]',
      codeHash:'[HASH]',
      codeFingerprint:'[HASH]',
      evaluatorHash:'[HASH]'
    }))
    output.scores = output.scores.map((x) => {
      const { taskId, createdAt, ...anonymous } = x
      return anonymous
    })
  }
  return output
}

function deploymentCheck(context, db) {
  const appEnv = getEnv(context,'APP_ENV','development')
  const production = appEnv === 'production'
  const allowlist = getEnv(context,'ALLOWED_ORIGINS','').split(',').map((x) => x.trim()).filter(Boolean)
  const adminSecretsConfigured = Boolean(getEnv(context,'ADMIN_TOKEN_SECRET',''))
  const publicSecretsConfigured = Boolean(getEnv(context,'PUBLIC_TOKEN_SECRET',''))
  const relationalStorage = getEnv(context,'STORAGE_MODEL','') === 'sqlite-relational'
  const defaultAdminNeedsChange = db.users.some((x) => x.username === 'admin' && x.mustChangePassword)
  const checks = [
    { id:'app-env', label:'生产环境标记', status:production ? 'pass' : 'warn', message:production ? 'APP_ENV=production 已配置' : '当前不是 production，上传前建议设置 APP_ENV=production' },
    { id:'kv', label:'KV 持久化绑定', status:hasPersistentKV(context) ? 'pass' : 'fail', message:hasPersistentKV(context) ? 'EVALUATION_KV 已绑定' : '未绑定 EVALUATION_KV，生产环境会无法持久化数据' },
    { id:'token-secrets', label:'Token 密钥', status:adminSecretsConfigured && publicSecretsConfigured ? 'pass' : 'fail', message:adminSecretsConfigured && publicSecretsConfigured ? '后台和公开评价 Token 密钥已配置' : '请配置 ADMIN_TOKEN_SECRET 与 PUBLIC_TOKEN_SECRET' },
    { id:'cors', label:'CORS 允许来源', status:production ? (allowlist.length ? 'pass' : 'warn') : 'warn', message:allowlist.length ? `已配置 ${allowlist.length} 个允许来源` : '生产环境建议配置 ALLOWED_ORIGINS' },
    { id:'cookie-secure', label:'后台 Cookie 安全标记', status:cookieSecure(context) ? 'pass' : 'warn', message:cookieSecure(context) ? '后台会话 Cookie 将带 Secure' : '当前环境未启用 Secure Cookie，本地 HTTP 调试可接受' },
    { id:'default-admin', label:'默认管理员密码', status:defaultAdminNeedsChange ? 'fail' : 'pass', message:defaultAdminNeedsChange ? '仍有初始管理员需要修改密码' : '未发现强制改密的初始管理员' },
    { id:'storage-model', label:'存储模型', status:relationalStorage?'pass':'warn', message:relationalStorage?'业务实体已使用 SQLite 关系表并由事务写入':'当前仍是整库快照存储，高并发评价建议使用关系表存储' }
  ]
  return { version:RUNTIME_VERSION, appEnv, checks, summary:{ pass:checks.filter((x) => x.status === 'pass').length, warn:checks.filter((x) => x.status === 'warn').length, fail:checks.filter((x) => x.status === 'fail').length } }
}

function cleanupDatabase(db) {
  const before = {
    timedInvites:db.timedInvites.length,
    logs:db.logs.length,
    tasks:db.tasks.length
  }
  expireTimedInvites(db)
  const retentionDays = Math.max(7,Number(db.settings?.logRetentionDays || 90))
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  db.logs = (db.logs || []).filter((x) => !x.createdAt || parseTime(x.createdAt) >= cutoff)
  db.tasks = db.tasks.filter((task) => {
    if (task.status === 'submitted') return true
    const evaluation = db.evaluationCodes.find((x) => x.id === task.evaluationCodeId)
    return Boolean(evaluation)
  })
  return {
    expiredTimedInvites:db.timedInvites.filter((x) => x.status === 'expired').length,
    removedLogs:before.logs - db.logs.length,
    removedTasks:before.tasks - db.tasks.length
  }
}

function performBatchMutation(db, session, currentUser, input) {
  const resource = normalize(input.resource)
  const action = normalize(input.action)
  const status = normalize(input.status)
  const ids = uniqueStrings(input.ids)
  if (!ids.length) throw httpError('请选择要批量操作的数据')
  if (ids.length > 200) throw httpError('单次批量操作最多 200 条')
  const runners = {
    employees: {
      status: (id) => { const denied = requirePermission(session,'employees:write'); if (denied) throw httpError('当前账号没有此操作权限',403); mutateEmployeeStatus(db,session,id,status) },
      delete: (id) => { const denied = requirePermission(session,'employees:write'); if (denied) throw httpError('当前账号没有此操作权限',403); deleteEmployee(db,session,id) }
    },
    users: {
      status: (id) => { const denied = requirePermission(session,'users:manage'); if (denied) throw httpError('当前账号没有此操作权限',403); mutateUserStatus(db,currentUser,id,status) },
      delete: (id) => { const denied = requirePermission(session,'users:manage'); if (denied) throw httpError('当前账号没有此操作权限',403); deleteUser(db,currentUser,id) }
    },
    departments: {
      status: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以编辑组织',403); mutateOrgStatus(db,'departments',id,status) },
      delete: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以删除组织',403); deleteOrg(db,'departments',id) }
    },
    teams: {
      status: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以编辑组织',403); mutateOrgStatus(db,'teams',id,status) },
      delete: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以删除组织',403); deleteOrg(db,'teams',id) }
    },
    periods: {
      status: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以编辑评价周期',403); mutatePeriodStatus(db,id,status) },
      delete: (id) => { if (session.role !== 'admin') throw httpError('只有管理员可以删除评价周期',403); deletePeriod(db,id) }
    },
    'evaluation-codes': {
      status: (id) => { const denied = requirePermission(session,'activities:write'); if (denied) throw httpError('当前账号没有此操作权限',403); mutateEvaluationStatus(db,session,id,status) },
      delete: (id) => { const denied = requirePermission(session,'activities:write'); if (denied) throw httpError('当前账号没有此操作权限',403); deleteEvaluation(db,session,id) }
    },
    'verify-codes': {
      delete: (id) => { const denied = requirePermission(session,'verify:write'); if (denied) throw httpError('当前账号没有此操作权限',403); deleteVerifyCode(db,session,id) }
    },
    tasks: {
      delete: (id) => { const denied = requirePermission(session,'tasks:write'); if (denied) throw httpError('当前账号没有此操作权限',403); deleteTask(db,session,id) }
    }
  }
  if (!runners[resource]) throw httpError('批量资源类型无效')
  if (!runners[resource][action]) throw httpError('该资源不支持当前批量操作')
  const items = ids.map((id) => {
    try {
      runners[resource][action](id)
      return { id, success:true }
    } catch (error) {
      return { id, success:false, message:String(error?.message || '操作失败') }
    }
  })
  const successCount = items.filter((x) => x.success).length
  return { items, successCount, failureCount:items.length - successCount }
}

async function publicRoutes(context,path,method,db) {
  if (path === '/public/evaluation-title' && method === 'POST') {
    const input = await bodyJson(context.request)
    const linkCode = normalize(input.linkCode).toUpperCase()
    const evaluation = db.evaluationCodes.find((x) => String(x.linkCode || '').toUpperCase() === linkCode)
    if (!evaluation || activityStatus(evaluation) !== 'active') return fail('评价不存在或已结束',404,'NOT_FOUND')
    return json({success:true,data:{name:evaluation.name}})
  }
  if (path === '/public/verify-entry' && method === 'POST') {
    const input = await bodyJson(context.request)
    const code = normalize(input.evaluationCode).toUpperCase()
    const verifyCode = normalize(input.verifyCode).toUpperCase()
    if (!code || !verifyCode) return fail('邀请链接和邀请码不能为空')
    const evaluation = db.evaluationCodes.find((x) => String(x.linkCode || '').toUpperCase() === code)
    if (!evaluation) return fail('评价不存在或已结束',404,'NOT_FOUND')
    const state = activityStatus(evaluation)
    if (state === 'disabled' || state === 'archived') return fail('该评价活动已停用',403)
    if (state === 'upcoming') return fail('该评价活动尚未开始',403)
    if (state === 'ended') return fail('该评价活动已结束',403)
    const codeHash = await hashVerifyCode(evaluation.id,verifyCode)
    const verify = db.verifyCodes.find((x) => x.evaluationCodeId === evaluation.id && x.codeHash === codeHash)
    if (!verify) return fail(/^\d{6}$/.test(verifyCode) ? '邀请码无效或与邀请链接不匹配' : '邀请码格式应为 6 位数字',403)
    syncVerifyProgress(db,verify)
    if (verify.expected === 0) return fail('该邀请码没有可评价任务，请联系管理员检查评价对象设置',409,'NO_TASKS')
    if (['locked','disabled'].includes(verify.status)) return fail('该邀请码已停用',403)
    if (verify.status === 'completed' || verify.remaining === 0) return fail('该邀请码已完成全部评价，不能重复填写',403,'COMPLETED')
    verify.firstUsedAt ||= nowText()
    verify.lastUsedAt = nowText()
    verify.status = 'in_progress'
    await saveDatabase(context,db)
    const token = await signToken({
      role:'evaluator', evaluationCodeId:evaluation.id, verifyCodeId:verify.id, evaluatorHash:verify.evaluatorHash
    }, evaluatorSecret(context), publicSessionSeconds(context,db))
    return json({
      success:true, token,
      evaluation:{id:evaluation.id,name:evaluation.name,teamName:db.teams.find((x) => x.id === evaluation.teamId)?.name || ''},
      remaining:verify.remaining
    })
  }
  if (path === '/public/timed-entry' && method === 'POST') {
    const input = await bodyJson(context.request)
    const linkCode = normalize(input.linkCode)
    const invite = db.timedInvites.find((x) => String(x.linkCode) === linkCode)
    if (!invite || ['completed','expired'].includes(invite.status)) return fail('评价不存在或已结束',404,'NOT_FOUND')
    const evaluation = db.evaluationCodes.find((x) => x.id === invite.evaluationCodeId)
    const verify = db.verifyCodes.find((x) => x.id === invite.verifyCodeId)
    if (!evaluation || !verify) return fail('评价不存在或已结束',404,'NOT_FOUND')
    const state = activityStatus(evaluation)
    if (state !== 'active') return fail('评价不存在或已结束',403,'ENDED')
    syncVerifyProgress(db,verify)
    if (verify.expected === 0 || verify.status === 'completed' || verify.remaining === 0) {
      invite.status = 'completed'
      invite.completedAt ||= nowText()
      await saveDatabase(context,db)
      return fail('评价不存在或已结束',403,'COMPLETED')
    }
    if (!invite.firstOpenedAt) {
      invite.firstOpenedAt = nowText()
      invite.expiresAt = new Date(Date.now() + timedInviteLifetimeSeconds(context) * 1000).toISOString()
      invite.status = 'active'
    }
    if (parseTime(invite.expiresAt) <= Date.now()) {
      invite.status = 'expired'
      await saveDatabase(context,db)
      return fail('评价不存在或已结束',403,'EXPIRED')
    }
    verify.firstUsedAt ||= nowText()
    verify.lastUsedAt = nowText()
    verify.status = 'in_progress'
    await saveDatabase(context,db)
    const expiresIn = Math.max(1,Math.floor((parseTime(invite.expiresAt) - Date.now()) / 1000))
    const token = await signToken({
      role:'evaluator', evaluationCodeId:evaluation.id, verifyCodeId:verify.id,
      evaluatorHash:verify.evaluatorHash, timedInviteId:invite.id
    }, evaluatorSecret(context), expiresIn)
    return json({
      success:true, token, timed:true, expiresAt:invite.expiresAt,
      evaluation:{id:evaluation.id,name:evaluation.name,teamName:db.teams.find((x) => x.id === evaluation.teamId)?.name || ''},
      remaining:verify.remaining
    })
  }

  const session = await requirePublic(context)
  if (!session) return fail('评价会话已失效，请重新进入',401)
  const evaluation = db.evaluationCodes.find((x) => x.id === session.evaluationCodeId)
  const verify = db.verifyCodes.find((x) => x.id === session.verifyCodeId)
  if (!evaluation || !verify) return fail('评价活动不存在',404)
  syncVerifyProgress(db,verify)
  const currentState = activityStatus(evaluation)
  if (currentState !== 'active') return fail(currentState === 'upcoming' ? '该评价活动尚未开始' : currentState === 'ended' ? '该评价活动已结束' : '该评价活动已停用',403)
  let timedInvite = null
  if (session.timedInviteId) {
    timedInvite = db.timedInvites.find((x) => x.id === session.timedInviteId && x.verifyCodeId === verify.id)
    if (!timedInvite || ['completed','expired'].includes(timedInvite.status) || parseTime(timedInvite.expiresAt) <= Date.now()) {
      if (timedInvite && timedInvite.status !== 'completed') {
        timedInvite.status = 'expired'
        await saveDatabase(context,db)
      }
      return fail('评价不存在或已结束',403,'EXPIRED')
    }
  }

  if (path === '/public/current-task' && method === 'GET') {
    const task = db.tasks.find((x) => x.verifyCodeId === verify.id && x.status === 'pending')
    if (!task) return fail(verify.remaining === 0 ? '该邀请码已完成全部评价' : '没有待评价任务',404)
    const targetType = itemTargetType(task,evaluation)
    const targetId = itemTargetId(task,evaluation)
    const target = targetType === 'team'
      ? getEvaluationTargets(db,evaluation).find((item) => item.id === targetId)
      : enrichEmployees(db).find((item) => item.id === targetId)
    if (!target) return fail('评价对象不存在，请联系管理员修复任务',409)
    return ok({
      id:task.id, target:{...target,targetType},targetType,
      evaluation:{id:evaluation.id,name:evaluation.name,teamName:db.teams.find((x) => x.id === evaluation.teamId)?.name || ''},
      rules:evaluation.rules, rounding:evaluation.rounding, remaining:verify.remaining,
      timed:Boolean(timedInvite), expiresAt:timedInvite?.expiresAt || null
    })
  }
  if (path === '/public/remaining' && method === 'GET') return ok({remaining:verify.remaining,completed:verify.remaining===0,timed:Boolean(timedInvite),expiresAt:timedInvite?.expiresAt || null})
  if (path === '/public/submit-score' && method === 'POST') {
    const input = await bodyJson(context.request)
    const task = db.tasks.find((x) => x.id === input.taskId && x.verifyCodeId === verify.id && x.evaluationCodeId === evaluation.id)
    if (!task) return fail('评价任务不存在',404)
    if (task.status === 'submitted' || db.scores.some((x) => x.taskId === task.id)) return fail('该评价对象已评价，不能重复提交',409,'TASK_ALREADY_SUBMITTED')
    const values = input.scores || {}
    for (const rule of evaluation.rules.filter((x) => x.enabled)) {
      const value = Number(values[rule.id])
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) return fail(`${rule.name}必须是 ${rule.min}-${rule.max} 的整数`)
    }
    const total = computeTotal(values,evaluation.rules,evaluation.rounding)
    if (total === null) return fail('评分数据无效')
    const scoreId = `score_${await sha256(`${verify.id}:${task.id}`)}`
    if (db.scores.some((x) => x.id === scoreId || x.taskId === task.id)) return fail('该评价对象已评价，不能重复提交',409,'TASK_ALREADY_SUBMITTED')
    const anonymousToken = await sha256(`${verify.evaluatorHash}:${task.id}`)
    const score = {
      id:scoreId, evaluationCodeId:evaluation.id, taskId:task.id,
      ...targetReference(itemTargetType(task,evaluation),itemTargetId(task,evaluation)),anonymousToken, values:copyJson(values), total, createdAt:nowText()
    }
    db.scores.push(score)
    task.status = 'submitted'
    task.submittedAt = nowText()
    syncVerifyProgress(db,verify)
    if (timedInvite && verify.remaining === 0) {
      timedInvite.status = 'completed'
      timedInvite.completedAt = nowText()
    }
    const scoreRepository = getScoreRepository(context)
    if (scoreRepository) {
      try {
        scoreRepository.submitAtomic({evaluationId:evaluation.id,verifyId:verify.id,taskId:task.id,score,task,verify,timedInvite})
      } catch (error) {
        if (error?.code === 'TASK_ALREADY_SUBMITTED') return fail('该评价对象已评价，不能重复提交',409,error.code)
        throw error
      }
    } else {
      await saveDatabase(context,db)
    }
    return ok({remaining:verify.remaining,completed:verify.remaining===0,total,timed:Boolean(timedInvite),expiresAt:timedInvite?.expiresAt || null})
  }
  if (path === '/public/logout' && method === 'POST') return ok({loggedOut:true})
  return fail('接口不存在',404)
}

async function adminRoutes(context,path,method,db) {
  if (path === '/admin/login' && method === 'POST') {
    const input = await bodyJson(context.request)
    const user = db.users.find((x) => x.username === normalize(input.username) && x.status === 'active')
    if (!user || !await verifyPassword(String(input.password || ''),user)) return fail('账号或密码错误',401)
    if (await upgradePasswordHashIfNeeded(user,String(input.password || ''))) await saveDatabase(context,db)
    const maxAge = Number(getEnv(context,'ADMIN_SESSION_SECONDS','28800'))
    const token = await signToken({
      kind:'backend', userId:user.id, username:user.username, role:user.role,
      teamId:user.teamId || '', departmentId:user.departmentId || '', employeeId:user.employeeId || ''
    },adminSecret(context),maxAge)
    return json({success:true,user:roleView(user)},200,{ 'set-cookie':adminCookie(context,token,maxAge) })
  }

  const tokenSession = await requireAdmin(context)
  if (!tokenSession) return fail('后台登录已失效',401)
  const currentUser = db.users.find((x) => x.id === tokenSession.userId && x.status === 'active')
  if (!currentUser) return fail('账号已停用或不存在',401)
  const session = {
    ...tokenSession,
    role:currentUser.role,
    teamId:currentUser.teamId || '',
    departmentId:currentUser.departmentId || '',
    employeeId:currentUser.employeeId || ''
  }
  const url = new URL(context.request.url)

  if (path === '/admin/me' && method === 'GET') return ok(roleView(currentUser))
  if (path === '/admin/logout' && method === 'POST') return json({success:true,data:{loggedOut:true}},200,{ 'set-cookie':clearAdminCookie(context) })
  if (currentUser.mustChangePassword && !(path === '/admin/change-password' && method === 'POST') && !(path === '/admin/settings' && method === 'GET')) {
    return fail('请先修改默认或初始密码',403,'PASSWORD_CHANGE_REQUIRED')
  }
  if (path === '/admin/change-password' && method === 'POST') {
    const denied = requirePermission(session,'settings:password'); if (denied) return denied
    const input = await bodyJson(context.request)
    if (!await verifyPassword(String(input.currentPassword || ''),currentUser)) return fail('当前密码错误',403)
    if (String(input.newPassword || '').length < 8) return fail('新密码至少 8 位')
    if (String(input.newPassword) === String(input.currentPassword || '')) return fail('新密码不能与当前密码相同',400)
    await setUserPassword(currentUser,String(input.newPassword),{forceChange:false})
    appendLog(db,session,'password.change',{userId:currentUser.id})
    await saveDatabase(context,db)
    return ok({changed:true})
  }

  if (path === '/admin/batch' && method === 'POST') {
    const input = await bodyJson(context.request)
    const result = performBatchMutation(db,session,currentUser,input)
    if (result.successCount > 0) {
      appendLog(db,session,'batch.operation',{resource:normalize(input.resource),action:normalize(input.action),successCount:result.successCount,failureCount:result.failureCount})
      await saveDatabase(context,db)
    }
    return ok(result)
  }

  if (path === '/admin/users' && method === 'GET') {
    const denied = requirePermission(session,'users:manage'); if (denied) return denied
    return ok({
      items:db.users.map((x) => ({...roleView(x),createdAt:x.createdAt,updatedAt:x.updatedAt})),
      options:{roles:Object.entries(ROLE_LABELS).map(([value,label]) => ({value,label})),teams:db.teams,departments:db.departments,employees:enrichEmployees(db)}
    })
  }
  if (path === '/admin/users' && method === 'POST') {
    const denied = requirePermission(session,'users:manage'); if (denied) return denied
    const input = await bodyJson(context.request)
    const username = normalize(input.username)
    const password = String(input.password || '')
    if (!username || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('账号需为 3-32 位字母、数字或 ._-')
    if (db.users.some((x) => x.username.toLowerCase() === username.toLowerCase())) return fail('账号已存在',409)
    if (!ROLE_LABELS[input.role]) return fail('角色无效')
    if (password.length < 8) return fail('初始密码至少 8 位')
    let scope
    try { scope = resolveUserScope(db,input.role,input) } catch (error) { return fail(String(error.message || error)) }
    const item = {
      id:randomId('user'),username,displayName:normalize(input.displayName)||username,role:input.role,
      ...scope,status:input.status === 'inactive' ? 'inactive' : 'active',
      createdAt:nowText(),updatedAt:nowText()
    }
    await setUserPassword(item,password,{forceChange:input.mustChangePassword !== false})
    db.users.push(item)
    appendLog(db,session,'user.create',{targetUserId:item.id,role:item.role})
    await saveDatabase(context,db)
    return ok(roleView(item))
  }
  let match = path.match(/^\/admin\/users\/([^/]+)$/)
  if (match && method === 'PUT') {
    const denied = requirePermission(session,'users:manage'); if (denied) return denied
    const input = await bodyJson(context.request)
    const item = db.users.find((x) => x.id === match[1])
    if (!item) return fail('账号不存在',404)
    const username = normalize(input.username) || item.username
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('账号需为 3-32 位字母、数字或 ._-')
    if (db.users.some((x) => x.id !== item.id && x.username.toLowerCase() === username.toLowerCase())) return fail('账号已存在',409)
    const nextRole = input.role || item.role
    if (!ROLE_LABELS[nextRole]) return fail('角色无效')
    let scope
    try { scope = resolveUserScope(db,nextRole,input) } catch (error) { return fail(String(error.message || error)) }
    const candidate = {
      ...item,username,displayName:normalize(input.displayName)||item.displayName,role:nextRole,...scope,
      status:input.status === 'inactive' ? 'inactive' : 'active',updatedAt:nowText()
    }
    const activeAdminCount = db.users.filter((x) => x.id !== item.id && x.role === 'admin' && x.status === 'active').length + (candidate.role === 'admin' && candidate.status === 'active' ? 1 : 0)
    if (activeAdminCount < 1) return fail('系统必须保留至少一个启用管理员',409)
    if (String(input.password || '').length) {
      if (String(input.password).length < 8) return fail('新密码至少 8 位')
      await setUserPassword(candidate,String(input.password),{forceChange:true})
    }
    Object.assign(item,candidate)
    appendLog(db,session,'user.update',{targetUserId:item.id})
    await saveDatabase(context,db)
    return ok(roleView(item))
  }

  if (match && method === 'DELETE') {
    const denied = requirePermission(session,'users:manage'); if (denied) return denied
    deleteUser(db,currentUser,match[1])
    appendLog(db,session,'user.delete',{targetUserId:match[1]})
    await saveDatabase(context,db)
    return ok({deleted:true})
  }

  if (path === '/admin/dashboard' && method === 'GET') {
    const denied = requirePermission(session,'dashboard:view'); if (denied) return denied
    const available = scopeEvaluations(db,session)
    const scopedEmployees = scopeEmployees(db,session).filter((x) => x.status === 'active')
    if (session.role === 'member') return ok({
      role:'member',mode:'member',activities:[],employeeCount:scopedEmployees.length,
      participants:null,completed:null,pending:null,completionRate:null,averageScore:'--',
      persistentKV:hasPersistentKV(context)
    })
    const requested = url.searchParams.get('evaluationCodeId')
    const evaluation = available.find((x) => x.id === requested) || available.map((x) => activityView(db,x)).find((x) => x.status === 'active') || available.at(-1)
    if (!evaluation) return ok({
      activities:[],participants:0,completed:0,pending:0,completionRate:0,
      employeeCount:scopedEmployees.length,averageScore:'--',persistentKV:hasPersistentKV(context),role:session.role
    })
    const view = activityView(db,evaluation)
    const scores = db.scores.filter((x) => x.evaluationCodeId === evaluation.id)
    const canSeeScores = hasPermission(session,'results:view') && session.role !== 'member'
    const activityViews = available.map((x) => activityView(db,x))
    const teamGroups = [...new Set(activityViews.map((x) => x.teamId))].map((teamId) => {
      const team = db.teams.find((x) => x.id === teamId)
      const activities = activityViews.filter((x) => x.teamId === teamId).map((activity) => {
        const activityScores = db.scores.filter((x) => x.evaluationCodeId === activity.id)
        return {
          id:activity.id,name:activity.name,status:activity.status,
          participantCount:activity.participantCount,completedParticipants:activity.completedParticipants,
          pendingParticipants:activity.pendingParticipants,completionRate:activity.completionRate,
          targetCount:activity.targetCount,taskCount:activity.taskCount,
          averageScore:canSeeScores && activityScores.length ? Math.round(activityScores.reduce((s,x) => s + Number(x.total),0) / activityScores.length * 10) / 10 : '--'
        }
      })
      const participants = activities.reduce((sum,x) => sum + Number(x.participantCount || 0),0)
      const completed = activities.reduce((sum,x) => sum + Number(x.completedParticipants || 0),0)
      return {
        teamId,teamName:team?.name || '未分组团队',departmentName:db.departments.find((x) => x.id === team?.departmentId)?.name || '',
        activityCount:activities.length,participants,completed,
        completionRate:participants ? Math.round(completed / participants * 100) : 0,
        activities
      }
    })
    return ok({
      ...view,participants:view.participantCount,completed:view.completedParticipants,pending:view.pendingParticipants,
      employeeCount:scopedEmployees.length,
      averageScore:canSeeScores && scores.length ? Math.round(scores.reduce((s,x) => s + Number(x.total),0) / scores.length * 10) / 10 : '--',
      persistentKV:hasPersistentKV(context),role:session.role,canSeeScores,
      activities:activityViews.map((x) => ({id:x.id,name:x.name,status:x.status,teamId:x.teamId,teamName:x.teamName})),
      teamGroups
    })
  }

  if (path === '/admin/evaluation-options' && method === 'GET') {
    const teams = db.teams.filter((x) => visibleTeamIds(db,session).has(x.id) && x.status !== 'inactive')
    const employees = scopeEmployees(db,session).filter((x) => x.status === 'active')
    const departmentIds = new Set(teams.map((team) => team.departmentId))
    const departments = db.departments.filter((department) => departmentIds.has(department.id) && department.status !== 'inactive')
    return ok({periods:db.periods,departments,teams,employees,defaultRules:copyJson(DEFAULT_RULES)})
  }

  if (path === '/admin/member-tags' && method === 'GET') {
    const denied = requirePermission(session,'employees:view'); if (denied) return denied
    const scopedEmployees = scopeEmployees(db,session)
    return ok({
      items:(db.memberTags || []).map((tag) => ({
        ...tag,memberCount:scopedEmployees.filter((employee) => (employee.tagIds || []).includes(tag.id)).length
      })),
      canCreate:hasPermission(session,'employees:write'),
      canManage:session.role === 'admin'
    })
  }
  if (path === '/admin/member-tags' && method === 'POST') {
    const denied = requirePermission(session,'employees:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    let name
    try { name = normalizeMemberTagName(input.name) } catch (error) { return fail(String(error.message || error)) }
    if ((db.memberTags || []).some((tag) => tag.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))) return fail('标签名称已存在',409)
    const tag = {id:randomId('tag'),name,createdAt:nowText(),updatedAt:nowText()}
    db.memberTags.push(tag)
    appendLog(db,session,'member_tag.create',{tagId:tag.id,name:tag.name})
    await saveDatabase(context,db)
    return ok({...tag,memberCount:0})
  }
  match = path.match(/^\/admin\/member-tags\/([^/]+)$/)
  if (match && method === 'PUT') {
    if (session.role !== 'admin') return fail('只有管理员可以重命名成员标签',403)
    const tag = db.memberTags.find((item) => item.id === match[1])
    if (!tag) return fail('成员标签不存在',404)
    const input = await bodyJson(context.request)
    let name
    try { name = normalizeMemberTagName(input.name) } catch (error) { return fail(String(error.message || error)) }
    if (db.memberTags.some((item) => item.id !== tag.id && item.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))) return fail('标签名称已存在',409)
    const previousName = tag.name
    Object.assign(tag,{name,updatedAt:nowText()})
    appendLog(db,session,'member_tag.rename',{tagId:tag.id,previousName,name})
    await saveDatabase(context,db)
    return ok(tag)
  }
  if (match && method === 'DELETE') {
    if (session.role !== 'admin') return fail('只有管理员可以删除成员标签',403)
    const tag = db.memberTags.find((item) => item.id === match[1])
    if (!tag) return fail('成员标签不存在',404)
    let detachedCount = 0
    db.employees.forEach((employee) => {
      if ((employee.tagIds || []).includes(tag.id)) detachedCount++
      employee.tagIds = (employee.tagIds || []).filter((id) => id !== tag.id)
    })
    db.memberTags = db.memberTags.filter((item) => item.id !== tag.id)
    appendLog(db,session,'member_tag.delete',{tagId:tag.id,name:tag.name,detachedCount})
    await saveDatabase(context,db)
    return ok({deleted:true,detachedCount})
  }

  if (path === '/admin/employees' && method === 'GET') {
    const denied = requirePermission(session,'employees:view'); if (denied) return denied
    const q = normalize(url.searchParams.get('q')).toLowerCase()
    const teamId = normalize(url.searchParams.get('teamId'))
    const departmentId = normalize(url.searchParams.get('departmentId'))
    const status = normalize(url.searchParams.get('status'))
    let items = scopeEmployees(db,session)
    if (q) items = items.filter((x) => [x.name,x.position,x.teamName,x.departmentName].some((v) => String(v || '').toLowerCase().includes(q)))
    if (teamId) items = items.filter((x) => x.teamId === teamId)
    if (departmentId) items = items.filter((x) => x.departmentId === departmentId)
    if (status) items = items.filter((x) => x.status === status)
    const allowedTeams = db.teams.filter((x) => visibleTeamIds(db,session).has(x.id))
    const allowedDepartmentIds = new Set(allowedTeams.map((x) => x.departmentId))
    return ok({
      items,
      options:{departments:db.departments.filter((x) => allowedDepartmentIds.has(x.id)),teams:allowedTeams,tags:db.memberTags || []},
      canWrite:hasPermission(session,'employees:write'),canManageTags:session.role === 'admin'
    })
  }
  match = path.match(/^\/admin\/employees\/([^/]+)$/)
  if (match && method === 'PUT') {
    const denied = requirePermission(session,'employees:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const index = db.employees.findIndex((x) => x.id === match[1])
    if (index < 0) return fail('员工不存在',404)
    const current = db.employees[index]
    if (!visibleTeamIds(db,session).has(current.teamId)) return fail('无权编辑该员工',403)
    const team = db.teams.find((x) => x.id === input.teamId)
    if (!team || !visibleTeamIds(db,session).has(team.id)) return fail('所属团队无效')
    if (team.departmentId !== input.departmentId) return fail('所属部门与团队不一致')
    delete input.employeeNo
    delete input.phone
    delete input.tags
    input.gender = ['male','female','unknown'].includes(input.gender) ? input.gender : current.gender
    input.avatar = normalizeEmployeeAvatar(input.avatar,input.gender)
    input.tagIds = resolveMemberTagIds(db,input.tagIds)
    db.employees[index] = {...current,...input,id:current.id,updatedAt:nowText()}
    delete db.employees[index].employeeNo
    delete db.employees[index].phone
    await saveDatabase(context,db)
    return ok(db.employees[index])
  }
  if (match && method === 'DELETE') {
    const denied = requirePermission(session,'employees:write'); if (denied) return denied
    deleteEmployee(db,session,match[1])
    await saveDatabase(context,db)
    return ok({deleted:true})
  }
  if (path === '/admin/employees' && method === 'POST') {
    const denied = requirePermission(session,'employees:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    if (!normalize(input.name)) return fail('员工姓名不能为空')
    const team = db.teams.find((x) => x.id === input.teamId)
    if (!team || !visibleTeamIds(db,session).has(team.id)) return fail('所属团队无效')
    if (team.departmentId !== input.departmentId) return fail('所属部门与团队不一致')
    delete input.employeeNo
    delete input.phone
    delete input.tags
    const gender = ['male','female','unknown'].includes(input.gender) ? input.gender : 'unknown'
    const employee = {
      ...input,id:randomId('emp'),gender,avatar:normalizeEmployeeAvatar(input.avatar,gender),
      tagIds:resolveMemberTagIds(db,input.tagIds),
      status:input.status === 'inactive' ? 'inactive' : 'active',createdAt:nowText(),updatedAt:nowText()
    }
    db.employees.push(employee)
    appendLog(db,session,'employee.create',{employeeId:employee.id,teamId:employee.teamId})
    await saveDatabase(context,db)
    return ok(employee)
  }

  for (const kind of ['departments','teams']) {
    if (path === `/admin/${kind}` && method === 'GET') {
      const permission = kind === 'departments' ? 'departments:view' : 'teams:view'
      if (session.role !== 'admin' && !hasPermission(session,'employees:view')) return fail('当前账号没有查看权限',403)
      let items = db[kind]
      if (kind === 'teams') items = items.filter((x) => visibleTeamIds(db,session).has(x.id))
      if (kind === 'departments' && session.role !== 'admin') {
        const ids = new Set(db.teams.filter((x) => visibleTeamIds(db,session).has(x.id)).map((x) => x.departmentId))
        items = items.filter((x) => ids.has(x.id))
      }
      return ok({items:items.map((x) => ({...x,departmentName:db.departments.find((d) => d.id === x.departmentId)?.name || ''})),departments:db.departments,canWrite:session.role==='admin'})
    }
    if (path === `/admin/${kind}` && method === 'POST') {
      if (session.role !== 'admin') return fail('只有管理员可以新增组织',403)
      const input = await bodyJson(context.request)
      if (!normalize(input.name)) return fail('名称不能为空')
      if (kind === 'teams' && !db.departments.some((x) => x.id === input.departmentId)) return fail('所属部门不存在')
      const item = {...input,id:randomId(kind==='teams'?'team':'dep'),status:input.status==='inactive'?'inactive':'active',createdAt:nowText(),updatedAt:nowText()}
      db[kind].push(item)
      await saveDatabase(context,db)
      return ok(item)
    }
    match = path.match(new RegExp(`^/admin/${kind}/([^/]+)$`))
    if (match && method === 'PUT') {
      if (session.role !== 'admin') return fail('只有管理员可以编辑组织',403)
      const input = await bodyJson(context.request)
      const index = db[kind].findIndex((x) => x.id === match[1])
      if (index < 0) return fail('记录不存在',404)
      if (kind === 'teams' && !db.departments.some((x) => x.id === input.departmentId)) return fail('所属部门不存在')
      const previous = db[kind][index]
      db[kind][index] = {...previous,...input,id:match[1],updatedAt:nowText()}
      if (kind === 'teams' && previous.departmentId !== input.departmentId) {
        db.employees.forEach((employee) => { if (employee.teamId === match[1]) employee.departmentId = input.departmentId })
        db.evaluationCodes.forEach((evaluation) => { if (evaluation.teamId === match[1]) evaluation.departmentId = input.departmentId })
        db.users.forEach((user) => { if (user.teamId === match[1]) user.departmentId = input.departmentId })
      }
      await saveDatabase(context,db)
      return ok(db[kind][index])
    }
    if (match && method === 'DELETE') {
      if (session.role !== 'admin') return fail('只有管理员可以删除组织',403)
      deleteOrg(db,kind,match[1])
      await saveDatabase(context,db)
      return ok({deleted:true})
    }
  }

  if (path === '/admin/periods' && method === 'GET') {
    const denied = requirePermission(session,'periods:view'); if (denied) return denied
    return ok({items:db.periods,canWrite:session.role==='admin'})
  }
  if (path === '/admin/periods' && method === 'POST') {
    if (session.role !== 'admin') return fail('只有管理员可以新增评价周期',403)
    const input = await bodyJson(context.request)
    if (!normalize(input.name) || !input.startTime || !input.endTime) return fail('周期名称和时间不能为空')
    if (parseTime(input.startTime) >= parseTime(input.endTime)) return fail('结束时间必须晚于开始时间')
    const item = {...input,id:randomId('period'),status:input.status||'active',anonymous:true,allowRepeat:false,allowModify:false,createdAt:nowText(),updatedAt:nowText()}
    db.periods.push(item)
    await saveDatabase(context,db)
    return ok(item)
  }
  match = path.match(/^\/admin\/periods\/([^/]+)$/)
  if (match && method === 'PUT') {
    if (session.role !== 'admin') return fail('只有管理员可以编辑评价周期',403)
    const input = await bodyJson(context.request)
    const index = db.periods.findIndex((x) => x.id === match[1])
    if (index < 0) return fail('周期不存在',404)
    if (parseTime(input.startTime) >= parseTime(input.endTime)) return fail('结束时间必须晚于开始时间')
    db.periods[index] = {...db.periods[index],...input,id:match[1],updatedAt:nowText()}
    await saveDatabase(context,db)
    return ok(db.periods[index])
  }
  if (match && method === 'DELETE') {
    if (session.role !== 'admin') return fail('只有管理员可以删除评价周期',403)
    deletePeriod(db,match[1])
    await saveDatabase(context,db)
    return ok({deleted:true})
  }

  if (path === '/admin/evaluation-codes' && method === 'GET') {
    const denied = requirePermission(session,'activities:view'); if (denied) return denied
    return ok({items:scopeEvaluations(db,session).map((x) => activityView(db,x)).sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||''))),canWrite:hasPermission(session,'activities:write')})
  }
  if (path === '/admin/evaluation-activities/create-flow' && method === 'POST') {
    const denied = requirePermission(session,'activities:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const team = db.teams.find((x) => x.id === input.teamId && x.status !== 'inactive')
    if (!team || !canWriteTeam(session,team.id)) return fail('请选择有权限管理的有效团队')
    if (!normalize(input.name)) return fail('评价活动名称不能为空')
    if (!input.startTime || !input.endTime || parseTime(input.startTime) >= parseTime(input.endTime)) return fail('开始时间和结束时间无效')

    const teamEmployees = db.employees.filter((x) => x.teamId === team.id && x.status === 'active')
    const teamEmployeeIdSet = new Set(teamEmployees.map((x) => x.id))
    const targetType = input.targetType === 'team' ? 'team' : 'employee'
    const targetMode = input.targetMode === 'selected' ? 'selected' : 'all'
    const availableTargetTeams = db.teams.filter((item) => visibleTeamIds(db,session).has(item.id) && item.status === 'active')
    const availableTargetTeamIds = new Set(availableTargetTeams.map((item) => item.id))
    const availableTargetEmployees = scopeEmployees(db,session).filter((employee) => employee.status === 'active' && availableTargetTeamIds.has(employee.teamId))
    const availableTargetEmployeeIds = new Set(availableTargetEmployees.map((employee) => employee.id))
    const requestedEmployeeScope = ['team','department','custom'].includes(input.employeeTargetScope) ? input.employeeTargetScope : null
    const employeeTargetScope = requestedEmployeeScope || (targetMode === 'selected' ? 'custom' : 'team')
    const targetTeamId = normalize(input.targetTeamId) || team.id
    const targetDepartmentId = normalize(input.targetDepartmentId) || team.departmentId
    let targetEmployeeIds = []
    if (targetType === 'employee' && employeeTargetScope === 'team') {
      if (!availableTargetTeamIds.has(targetTeamId)) return fail('请选择有权限访问的有效目标团队')
      targetEmployeeIds = availableTargetEmployees.filter((employee) => employee.teamId === targetTeamId).map((employee) => employee.id)
    } else if (targetType === 'employee' && employeeTargetScope === 'department') {
      const departmentTeamIds = new Set(availableTargetTeams.filter((item) => item.departmentId === targetDepartmentId).map((item) => item.id))
      if (!departmentTeamIds.size) return fail('请选择有权限访问的有效目标部门')
      targetEmployeeIds = availableTargetEmployees.filter((employee) => departmentTeamIds.has(employee.teamId)).map((employee) => employee.id)
    } else if (targetType === 'employee') {
      const candidateIds = uniqueStrings(input.targetEmployeeIds)
      targetEmployeeIds = candidateIds.filter((id) => availableTargetEmployeeIds.has(id))
      if (!requestedEmployeeScope) targetEmployeeIds = targetEmployeeIds.filter((id) => teamEmployeeIdSet.has(id))
    }
    const targetTeamIds = targetType === 'team'
      ? (targetMode === 'selected' ? uniqueStrings(input.targetTeamIds).filter((id) => availableTargetTeamIds.has(id)) : availableTargetTeams.map((item) => item.id))
      : []
    if (!(targetType === 'team' ? targetTeamIds : targetEmployeeIds).length) return fail('至少选择 1 个评价对象')

    const participantMode = input.participantMode === 'selected' ? 'selected' : 'quantity'
    const participantEmployeeIds = participantMode === 'selected'
      ? uniqueStrings(input.participantEmployeeIds).filter((id) => teamEmployeeIdSet.has(id))
      : []
    const participantCount = participantMode === 'selected' ? participantEmployeeIds.length : Number(input.participantCount)
    if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 200) return fail('邀请码数量必须是 1-200 的整数')

    const periodMode = input.periodMode === 'existing' ? 'existing' : 'new'
    let period = periodMode === 'existing' ? db.periods.find((x) => x.id === input.periodId && x.status !== 'inactive') : null
    if (periodMode === 'existing' && !period) return fail('请选择有效的评价周期')
    if (period && parseTime(period.endTime) < Date.now()) return fail('所选评价周期已结束，请选择其他周期')
    if (period && (parseTime(input.startTime) < parseTime(period.startTime) || parseTime(input.endTime) > parseTime(period.endTime))) return fail('评价活动时间必须处于所选周期时间范围内')
    if (!period) {
      period = {
        id:randomId('period'),name:normalize(input.periodName)||`${normalize(input.name)}周期`,
        startTime:input.startTime,endTime:input.endTime,status:'active',anonymous:true,allowRepeat:false,allowModify:false,
        createdAt:nowText(),updatedAt:nowText()
      }
      db.periods.push(period)
    }
    const evaluation = {
      id:randomId('eval'),code:await generateEvaluationCode(db),name:normalize(input.name),periodId:period.id,
      linkCode:generateUniqueLinkCode(db),
      teamId:team.id,departmentId:team.departmentId,status:'active',startTime:input.startTime,endTime:input.endTime,
      rules:prepareScoreRules(Array.isArray(input.rules)&&input.rules.length?input.rules:DEFAULT_RULES),rounding:input.rounding||DEFAULT_ROUNDING,
      participantMode,participantEmployeeIds,targetType,
      targetMode:targetType === 'team' ? targetMode : employeeTargetScope === 'custom' ? 'selected' : 'all',
      employeeTargetScope,targetTeamId,targetDepartmentId,targetEmployeeIds,targetTeamIds,
      excludeSelf:targetType === 'employee' && input.excludeSelf !== false,
      createdAt:nowText(),updatedAt:nowText()
    }
    db.evaluationCodes.push(evaluation)
    const generated = await addVerifyCodesAndTasks(db,evaluation,{
      participantEmployeeIds:participantMode==='selected'?participantEmployeeIds:[],
      count:participantMode==='quantity'?participantCount:0
    })
    await saveDatabase(context,db)
    return ok({activity:activityView(db,evaluation),period,verifyCodes:generated.codes,participantCount,taskCount:generated.taskCount,targetCount:generated.targetCount})
  }
  match = path.match(/^\/admin\/evaluation-codes\/([^/]+)$/)
  if (match && method === 'PUT') {
    const denied = requirePermission(session,'activities:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const evaluation = db.evaluationCodes.find((x) => x.id === match[1])
    if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) return fail('评价活动不存在或无权编辑',404)
    if (evaluation.status === 'archived' && !(input.status === 'active' && Object.keys(input).every((key) => key === 'status'))) return fail('已归档活动为只读状态，只能恢复归档',409,'EVALUATION_ARCHIVED')
    if (input.status === 'archived' && Object.keys(input).some((key) => key !== 'status')) return fail('归档活动时不能同时修改其他字段',400)
    const updates = {}
    if (input.name !== undefined) updates.name = normalize(input.name) || evaluation.name
    if (input.status !== undefined) {
      if (!['active','disabled','archived'].includes(input.status)) return fail('活动状态无效')
      try { mutateEvaluationStatus(db,session,evaluation.id,input.status) } catch (error) { return fail(String(error.message || error),Number(error.status)||400,error.code) }
    }
    if (input.startTime !== undefined) updates.startTime = input.startTime
    if (input.endTime !== undefined) updates.endTime = input.endTime
    if ((updates.startTime || updates.endTime) && parseTime(updates.startTime || evaluation.startTime) >= parseTime(updates.endTime || evaluation.endTime)) return fail('开始时间和结束时间无效')
    if (updates.startTime || updates.endTime) {
      const period = db.periods.find((item) => item.id === evaluation.periodId)
      if (!period || parseTime(updates.startTime || evaluation.startTime) < parseTime(period.startTime) || parseTime(updates.endTime || evaluation.endTime) > parseTime(period.endTime)) return fail('评价活动时间必须处于所属周期时间范围内')
    }
    Object.assign(evaluation,updates,{updatedAt:nowText()})
    await saveDatabase(context,db)
    return ok(activityView(db,evaluation))
  }
  if (match && method === 'DELETE') {
    const denied = requirePermission(session,'activities:write'); if (denied) return denied
    deleteEvaluation(db,session,match[1])
    await saveDatabase(context,db)
    return ok({deleted:true})
  }

  if (path === '/admin/verify-codes' && method === 'GET') {
    const denied = requirePermission(session,'verify:view'); if (denied) return denied
    const allowed = new Set(scopeEvaluations(db,session).map((x) => x.id))
    const evaluationCodeId = url.searchParams.get('evaluationCodeId')
    let items = db.verifyCodes.filter((x) => allowed.has(x.evaluationCodeId))
    if (evaluationCodeId) items = items.filter((x) => x.evaluationCodeId === evaluationCodeId)
    return ok({
      items:items.map((v) => {
        syncVerifyProgress(db,v)
        const e = db.evaluationCodes.find((x) => x.id === v.evaluationCodeId)
        const t = db.teams.find((x) => x.id === e?.teamId)
        const participant = db.employees.find((x) => x.id === v.participantEmployeeId)
        return {
          id:v.id,evaluationCodeId:v.evaluationCodeId,code:v.code||v.codeMask||`****${v.suffix||''}`,
          activityName:e?.name,teamName:t?.name,participantName:participant?.name||'未绑定成员',
          expected:v.expected,submitted:v.submitted,remaining:v.remaining,status:v.status,
          statusLabel:v.status==='completed'?'已完成':v.status==='in_progress'?'进行中':v.status==='unused'?'未使用':v.status,
          firstUsedAt:v.firstUsedAt,completedAt:v.completedAt
        }
      }),
      activities:scopeEvaluations(db,session).map((x) => ({id:x.id,name:x.name,status:activityStatus(x),teamId:x.teamId,teamName:db.teams.find((t) => t.id===x.teamId)?.name || ''})),
      canWrite:hasPermission(session,'verify:write')
    })
  }
  if (path === '/admin/verify-codes/generate' && method === 'POST') {
    const denied = requirePermission(session,'verify:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const evaluation = db.evaluationCodes.find((x) => x.id === input.evaluationCodeId)
    if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) return fail('评价活动不存在或无权操作',404)
    try { ensureEvaluationMutable(evaluation,'生成邀请码') } catch (error) { return fail(String(error.message || error),Number(error.status)||400,error.code) }
    const participantEmployeeIds = uniqueStrings(input.participantEmployeeIds)
    const count = participantEmployeeIds.length ? 0 : Math.min(100,Math.max(1,Number(input.count)||1))
    const generated = await addVerifyCodesAndTasks(db,evaluation,{participantEmployeeIds,count})
    await saveDatabase(context,db)
    return ok({codes:generated.codes,taskCount:generated.taskCount,targetCount:generated.targetCount})
  }
  if (path === '/admin/timed-invites/generate' && method === 'POST') {
    const denied = requirePermission(session,'verify:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const evaluation = db.evaluationCodes.find((x) => x.id === input.evaluationCodeId)
    if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) return fail('评价活动不存在或无权操作',404)
    try { ensureEvaluationMutable(evaluation,'生成时效链接') } catch (error) { return fail(String(error.message || error),Number(error.status)||400,error.code) }
    if (activityStatus(evaluation) !== 'active') return fail('只能为进行中的评价活动生成时效链接')
    const generated = await addVerifyCodesAndTasks(db,evaluation,{count:1})
    const verifyCodeId = generated.codes[0]?.id
    if (!verifyCodeId) return fail('时效链接任务生成失败',500)
    const invite = {
      id:randomId('timed'), linkCode:generateUniqueLinkCode(db,'linkCode',8),
      evaluationCodeId:evaluation.id, verifyCodeId, status:'unused',
      createdAt:nowText(), firstOpenedAt:null, expiresAt:null, completedAt:null
    }
    db.timedInvites.push(invite)
    await saveDatabase(context,db)
    return ok({id:invite.id,linkCode:invite.linkCode,evaluationCodeId:evaluation.id,activityName:evaluation.name,taskCount:generated.taskCount,targetCount:generated.targetCount})
  }
  if (path === '/admin/timed-invites' && method === 'GET') {
    const denied = requirePermission(session,'verify:view'); if (denied) return denied
    expireTimedInvites(db)
    const allowedEvaluations = scopeEvaluations(db,session)
    const allowedIds = new Set(allowedEvaluations.map((evaluation) => evaluation.id))
    const evaluationCodeId = normalize(url.searchParams.get('evaluationCodeId'))
    let items = db.timedInvites.filter((invite) => allowedIds.has(invite.evaluationCodeId))
    if (evaluationCodeId) items = items.filter((invite) => invite.evaluationCodeId === evaluationCodeId)
    return ok({
      items:items.map((invite) => {
        const evaluation = db.evaluationCodes.find((item) => item.id === invite.evaluationCodeId)
        return {...timedInviteView(db,invite),activityName:evaluation?.name || '',teamName:db.teams.find((team) => team.id === evaluation?.teamId)?.name || ''}
      }).sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
      activities:allowedEvaluations.map((evaluation) => ({id:evaluation.id,name:evaluation.name,status:activityStatus(evaluation),teamName:db.teams.find((team) => team.id === evaluation.teamId)?.name || ''}))
    })
  }
  match = path.match(/^\/admin\/verify-codes\/([^/]+)$/)
  if (match && method === 'DELETE') {
    const denied = requirePermission(session,'verify:write'); if (denied) return denied
    deleteVerifyCode(db,session,match[1])
    await saveDatabase(context,db)
    return ok({deleted:true})
  }

  if (path === '/admin/tasks/generate' && method === 'POST') {
    const denied = requirePermission(session,'tasks:write'); if (denied) return denied
    const input = await bodyJson(context.request)
    const evaluation = db.evaluationCodes.find((x) => x.id === input.evaluationCodeId)
    if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) return fail('评价活动不存在或无权操作',404)
    try { ensureEvaluationMutable(evaluation,'同步任务') } catch (error) { return fail(String(error.message || error),Number(error.status)||400,error.code) }
    const targets = getEvaluationTargets(db,evaluation)
    const verifies = db.verifyCodes.filter((x) => x.evaluationCodeId === evaluation.id)
    let created = 0
    let removed = 0
    for (const verify of verifies) {
      const targetType = evaluationTargetType(evaluation)
      const desiredTargets = targets.filter((target) => !(targetType === 'employee' && evaluation.excludeSelf && verify.participantEmployeeId && target.id === verify.participantEmployeeId))
      const desiredKeys = new Set(desiredTargets.map((target) => targetKey(targetType,target.id)))
      const existing = db.tasks.filter((x) => x.verifyCodeId === verify.id)
      for (const task of existing) {
        if (!desiredKeys.has(targetKey(itemTargetType(task,evaluation),itemTargetId(task,evaluation))) && task.status !== 'submitted') {
          db.tasks = db.tasks.filter((x) => x.id !== task.id)
          removed++
        }
      }
      for (const target of desiredTargets) {
        const key = targetKey(targetType,target.id)
        if (!db.tasks.some((x) => x.verifyCodeId === verify.id && targetKey(itemTargetType(x,evaluation),itemTargetId(x,evaluation)) === key)) {
          db.tasks.push({id:randomId('task'),evaluationCodeId:evaluation.id,verifyCodeId:verify.id,evaluatorHash:verify.evaluatorHash,...targetReference(targetType,target.id),status:'pending',submittedAt:null})
          created++
        }
      }
      syncVerifyProgress(db,verify)
    }
    await saveDatabase(context,db)
    return ok({created,removed})
  }
  if (path === '/admin/tasks' && method === 'GET') {
    const denied = requirePermission(session,'tasks:view'); if (denied) return denied
    const allowed = new Set(scopeEvaluations(db,session).map((x) => x.id))
    const evaluationCodeId = url.searchParams.get('evaluationCodeId')
    let items = db.tasks.filter((x) => allowed.has(x.evaluationCodeId))
    if (evaluationCodeId) items = items.filter((x) => x.evaluationCodeId === evaluationCodeId)
    const employees = enrichEmployees(db)
    return ok({
      items:items.map((t) => {
        const e = db.evaluationCodes.find((x) => x.id === t.evaluationCodeId)
        const v = db.verifyCodes.find((x) => x.id === t.verifyCodeId)
        const targetType = itemTargetType(t,e)
        const targetId = itemTargetId(t,e)
        const target = targetType === 'team'
          ? getEvaluationTargets(db,e).find((item) => item.id === targetId) || db.teams.find((item) => item.id === targetId)
          : employees.find((item) => item.id === targetId)
        const participant = employees.find((x) => x.id === v?.participantEmployeeId)
        return {...t,targetType,targetId,evaluatorHash:undefined,activityName:e?.name,verifyCode:v?.code||v?.codeMask||`****${v?.suffix||''}`,participantName:participant?.name||'未绑定成员',targetName:target?.name,teamName:targetType === 'team' ? target?.name : target?.teamName,scopeName:targetType === 'team' ? target?.departmentName : target?.teamName}
      }),
      activities:scopeEvaluations(db,session).map((x) => ({id:x.id,name:x.name,teamName:db.teams.find((t) => t.id===x.teamId)?.name || ''})),
      canWrite:hasPermission(session,'tasks:write')
    })
  }
  match = path.match(/^\/admin\/tasks\/([^/]+)$/)
  if (match && method === 'DELETE') {
    const denied = requirePermission(session,'tasks:write'); if (denied) return denied
    deleteTask(db,session,match[1])
    await saveDatabase(context,db)
    return ok({deleted:true})
  }

  if (path === '/admin/results' && method === 'GET') {
    const denied = requirePermission(session,'results:view'); if (denied) return denied
    if (session.role === 'member') return fail('成员账号不能查看评分结果',403)
    const available = scopeEvaluations(db,session)
    const evaluationCodeId = url.searchParams.get('evaluationCodeId') || available.at(-1)?.id
    const evaluation = available.find((x) => x.id === evaluationCodeId)
    if (!evaluation) return ok({items:[],rules:[],activities:[]})
    const rules = evaluation.rules || DEFAULT_RULES
    const scoresForActivity = db.scores.filter((s) => s.evaluationCodeId === evaluation.id)
    const targetType = evaluationTargetType(evaluation)
    const targets = getEvaluationTargets(db,evaluation)
    const items = targets.map((target) => {
      const scores = scoresForActivity.filter((score) => itemTargetType(score,evaluation) === targetType && itemTargetId(score,evaluation) === target.id)
      const average = (id) => {
        const values = scores.map((score) => Number(score.values?.[id])).filter(Number.isFinite)
        return values.length ? Math.round(values.reduce((sum,value) => sum + value,0) / values.length * 10) / 10 : '--'
      }
      const total = scores.length ? Math.round(scores.reduce((a,s) => a + Number(s.total),0) / scores.length * 10) / 10 : '--'
      return {
        id:target.id,targetType,name:target.name,
        genderLabel:targetType === 'employee' ? (target.gender==='female'?'女':target.gender==='male'?'男':'未知') : '',
        departmentName:target.departmentName,teamName:target.teamName,position:targetType === 'employee' ? target.position : '',
        memberCount:targetType === 'team' ? target.memberCount : undefined,reviewCount:scores.length,
        values:Object.fromEntries(rules.filter((rule) => rule.enabled).map((rule) => [rule.id,average(rule.id)])),total
      }
    }).sort((a,b) => Number(b.total==='--'?-1:b.total)-Number(a.total==='--'?-1:a.total)).map((x,i) => ({...x,rank:x.total==='--'?'--':i+1}))
    return ok({
      items,rules,targetType,activity:activityView(db,evaluation),
      activities:available.map((x) => ({id:x.id,name:x.name,code:x.code,targetType:evaluationTargetType(x),teamId:x.teamId,teamName:db.teams.find((t) => t.id===x.teamId)?.name||''}))
    })
  }

  if (path === '/admin/trends/options' && method === 'GET') {
    const denied = requirePermission(session,'results:view'); if (denied) return denied
    if (session.role === 'member') return fail('成员账号不能查看评分趋势',403)
    return ok({
      employees:scopeEmployees(db,session).map((employee) => ({id:employee.id,name:employee.name,departmentName:employee.departmentName,teamName:employee.teamName,status:employee.status})),
      teams:db.teams.filter((team) => visibleTeamIds(db,session).has(team.id)).map((team) => ({id:team.id,name:team.name,departmentId:team.departmentId,departmentName:db.departments.find((department) => department.id === team.departmentId)?.name || '',status:team.status}))
    })
  }
  if (path === '/admin/trends' && method === 'GET') {
    const denied = requirePermission(session,'results:view'); if (denied) return denied
    if (session.role === 'member') return fail('成员账号不能查看评分趋势',403)
    const targetType = url.searchParams.get('targetType') === 'team' ? 'team' : 'employee'
    const targetId = normalize(url.searchParams.get('targetId'))
    if (!targetId) return ok({targetType,target:null,points:[]})
    const target = targetType === 'team'
      ? db.teams.find((team) => team.id === targetId && visibleTeamIds(db,session).has(team.id))
      : scopeEmployees(db,session).find((employee) => employee.id === targetId)
    if (!target) return fail('评价对象不存在或无权查看',403)
    const startTime = normalize(url.searchParams.get('startTime'))
    const endTime = normalize(url.searchParams.get('endTime'))
    const start = startTime ? parseTime(startTime) : null
    const end = endTime ? parseTime(endTime) : null
    if ((startTime && !Number.isFinite(start)) || (endTime && !Number.isFinite(end)) || (start !== null && end !== null && start > end)) return fail('趋势时间范围无效')
    const points = scopeEvaluations(db,session).filter((evaluation) => {
      const evaluationTime = parseTime(evaluation.endTime)
      return (start === null || evaluationTime >= start) && (end === null || evaluationTime <= end)
    }).map((evaluation) => {
      const scores = db.scores.filter((score) => score.evaluationCodeId === evaluation.id && itemTargetType(score,evaluation) === targetType && itemTargetId(score,evaluation) === targetId)
      if (!scores.length) return null
      const total = Math.round(scores.reduce((sum,score) => sum + Number(score.total),0) / scores.length * 10) / 10
      return {
        activityId:evaluation.id,activityName:evaluation.name,periodId:evaluation.periodId,
        periodName:db.periods.find((period) => period.id === evaluation.periodId)?.name || '',
        evaluationTime:evaluation.endTime,reviewCount:scores.length,total,status:activityStatus(evaluation),archived:evaluation.status === 'archived'
      }
    }).filter(Boolean).sort((a,b) => parseTime(a.evaluationTime) - parseTime(b.evaluationTime) || String(a.activityId).localeCompare(String(b.activityId)))
    const targetView = targetType === 'team'
      ? {id:target.id,name:target.name,departmentName:db.departments.find((department) => department.id === target.departmentId)?.name || '',targetType}
      : {id:target.id,name:target.name,departmentName:target.departmentName,teamName:target.teamName,targetType}
    return ok({targetType,target:targetView,points})
  }

  if (path === '/admin/settings/score-rules' && method === 'GET') {
    if (session.role !== 'admin' && session.role !== 'team_leader') return fail('当前账号没有评分规则查看权限',403)
    const available = scopeEvaluations(db,session)
    const evaluationId = url.searchParams.get('evaluationCodeId')
    const evaluation = available.find((x) => x.id === evaluationId) || available.map((x) => activityView(db,x)).find((x) => x.status==='active') || available.at(-1)
    if (!evaluation) return fail('暂无评价活动',404)
    return ok({
      evaluation:{id:evaluation.id,name:evaluation.name,periodId:evaluation.periodId,status:activityStatus(evaluation)},
      rules:evaluation.rules,rounding:evaluation.rounding,
      activities:available.map((x) => ({id:x.id,name:x.name,periodId:x.periodId,status:activityStatus(x),teamName:db.teams.find((t) => t.id===x.teamId)?.name||''})),periods:db.periods
    })
  }
  if (path === '/admin/settings/score-rules' && method === 'PUT') {
    if (session.role !== 'admin' && session.role !== 'team_leader') return fail('当前账号没有修改评分规则权限',403)
    const input = await bodyJson(context.request)
    const evaluation = db.evaluationCodes.find((x) => x.id === input.evaluationCodeId)
    if (!canAccessEvaluation(db,session,evaluation) || !canWriteTeam(session,evaluation?.teamId)) return fail('评价活动不存在或无权操作',404)
    try { ensureEvaluationMutable(evaluation,'修改评分规则') } catch (error) { return fail(String(error.message || error),Number(error.status)||400,error.code) }
    evaluation.rules = prepareScoreRules(input.rules || [])
    evaluation.rounding = input.rounding || DEFAULT_ROUNDING
    evaluation.updatedAt = nowText()
    await saveDatabase(context,db)
    return ok({saved:true})
  }

  if (path === '/admin/settings' && method === 'GET') return ok({...db.settings,canEdit:session.role==='admin'})
  if (path === '/admin/settings' && method === 'PUT') {
    if (session.role !== 'admin') return fail('只有管理员可以修改基础设置',403)
    const input = await bodyJson(context.request)
    db.settings = sanitizeSettings(input,db.settings)
    appendLog(db,session,'settings.update',{keys:Object.keys(input).filter((key) => ['systemName','publicSessionMinutes','logRetentionDays'].includes(key))})
    await saveDatabase(context,db)
    return ok(db.settings)
  }
  if (path === '/admin/deployment-check' && method === 'GET') {
    if (session.role !== 'admin') return fail('只有管理员可以查看部署检查',403)
    return ok(deploymentCheck(context,db))
  }
  if (path === '/admin/logs' && method === 'GET') {
    if (session.role !== 'admin') return fail('只有管理员可以查看操作日志',403)
    const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit')) || 80))
    return ok({items:(db.logs || []).slice(-limit).reverse()})
  }
  if (path === '/admin/maintenance/cleanup' && method === 'POST') {
    if (session.role !== 'admin') return fail('只有管理员可以执行维护清理',403)
    const result = cleanupDatabase(db)
    appendLog(db,session,'maintenance.cleanup',result)
    await saveDatabase(context,db)
    return ok(result)
  }
  if (path === '/admin/export/json' && method === 'GET') {
    if (session.role !== 'admin') return fail('只有管理员可以导出完整数据',403)
    return ok(cleanExport(db,{sensitive:false}))
  }
  if (path === '/admin/export/full-json' && method === 'POST') {
    if (session.role !== 'admin') return fail('只有管理员可以导出完整备份',403)
    const input = await bodyJson(context.request)
    if (input.confirm !== 'EXPORT_FULL_BACKUP') return fail('完整备份包含敏感邀请码和哈希，请输入确认标记',400,'CONFIRM_REQUIRED')
    appendLog(db,session,'export.full',{verifyCodeCount:db.verifyCodes.length,scoreCount:db.scores.length})
    await saveDatabase(context,db)
    return ok(cleanExport(db,{sensitive:true}))
  }
  if (path === '/admin/import/json' && method === 'POST') {
    if (session.role !== 'admin') return fail('只有管理员可以导入数据',403)
    const input = await bodyJson(context.request)
    validateImportData(input.data)
    const originalUsers = db.users
    db = migrateDatabase({...input.data,users:originalUsers,importedAt:nowText()})
    appendLog(db,session,'import.json',{employees:db.employees.length,evaluationCodes:db.evaluationCodes.length})
    await saveDatabase(context,db)
    return ok({imported:true})
  }
  return fail('接口不存在',404)
}

async function directCurrentTask(context) {
  const session = await requirePublic(context)
  if (!session) return fail('评价会话已失效，请重新进入',401)
  const repository = getTaskRepository(context)
  if (!repository) return null
  const result = repository.findCurrentTask({
    evaluationId:session.evaluationCodeId, verifyId:session.verifyCodeId, timedInviteId:session.timedInviteId || ''
  })
  if (!result) return fail('评价活动不存在',404)
  const state = activityStatus(result.evaluation)
  if (state !== 'active') return fail(state === 'upcoming' ? '该评价活动尚未开始' : state === 'ended' ? '该评价活动已结束' : '该评价活动已停用',403)
  if (result.timedInvite && ['completed','expired'].includes(result.timedInvite.status)) return fail('评价不存在或已结束',403,'EXPIRED')
  if (result.timedInvite?.expiresAt && new Date(result.timedInvite.expiresAt).getTime() <= Date.now()) return fail('评价不存在或已结束',403,'EXPIRED')
  if (!result.task) return fail(result.remaining === 0 ? '该邀请码已完成全部评价' : '没有待评价任务',404)
  return ok({
    id:result.task.id, target:result.task.target, targetType:result.task.targetType,
    evaluation:{id:result.evaluation.id,name:result.evaluation.name,teamName:result.evaluation.teamName},
    rules:result.rules, rounding:result.evaluation.rounding || 'one_decimal', remaining:result.remaining,
    timed:Boolean(result.timedInvite), expiresAt:result.timedInvite?.expiresAt || null
  })
}

async function directRemaining(context) {
  const session = await requirePublic(context)
  if (!session) return fail('评价会话已失效，请重新进入',401)
  const repository = getTaskRepository(context)
  if (!repository) return null
  const result = repository.findProgress({
    evaluationId:session.evaluationCodeId, verifyId:session.verifyCodeId, timedInviteId:session.timedInviteId || ''
  })
  if (!result) return fail('评价活动不存在',404)
  if (result.timedInvite && ['completed','expired'].includes(result.timedInvite.status)) return fail('评价不存在或已结束',403,'EXPIRED')
  if (result.timedInvite?.expiresAt && new Date(result.timedInvite.expiresAt).getTime() <= Date.now()) return fail('评价不存在或已结束',403,'EXPIRED')
  return ok({remaining:result.remaining,completed:result.remaining === 0,timed:Boolean(result.timedInvite),expiresAt:result.timedInvite?.expiresAt || null})
}

async function directTimedEntry(context) {
  const repository = getTaskRepository(context)
  if (!repository) return null
  const input = await bodyJson(context.request)
  const linkCode = normalize(input.linkCode)
  const result = repository.openTimedInvite({
    linkCode, lifetimeSeconds:timedInviteLifetimeSeconds(context)
  })
  if (result.kind === 'not-found') return fail('评价不存在或已结束',404,'NOT_FOUND')
  if (result.kind === 'ended') return fail('评价不存在或已结束',403,'ENDED')
  if (result.kind === 'completed') return fail('评价不存在或已结束',403,'COMPLETED')
  if (result.kind === 'expired') return fail('评价不存在或已结束',403,'EXPIRED')
  const token = await signToken({
    role:'evaluator', evaluationCodeId:result.evaluation.id, verifyCodeId:result.verifyId,
    evaluatorHash:result.evaluatorHash, timedInviteId:result.inviteId
  }, evaluatorSecret(context), result.expiresIn)
  return json({
    success:true, token, timed:true, expiresAt:result.expiresAt,
    evaluation:{id:result.evaluation.id,name:result.evaluation.name,teamName:result.evaluation.teamName},
    remaining:result.remaining
  })
}

async function directAdminSession(context, repository) {
  const tokenSession = await requireAdmin(context)
  if (!tokenSession) return { response:fail('后台登录已失效',401) }
  const user = repository.findUser(tokenSession.userId)
  if (!user || user.status !== 'active') return { response:fail('账号已停用或不存在',401) }
  if (user.mustChangePassword) return { response:fail('请先修改默认或初始密码',403,'PASSWORD_CHANGE_REQUIRED') }
  return { session:{...tokenSession,role:user.role,teamId:user.teamId || '',departmentId:user.departmentId || '',employeeId:user.employeeId || ''}, user }
}

async function directAdminResults(context) {
  const repository = getScoreRepository(context)
  if (!repository || typeof repository.listResults !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('成员账号不能查看评分结果',403)
  const url = new URL(context.request.url)
  const result = repository.listResults(access.session,url.searchParams.get('evaluationCodeId') || '')
  return ok({
    ...result,
    activity:result.activity ? {...result.activity,status:activityStatus(result.activity),lifecycleStatus:result.activity.status} : result.activity
  })
}

async function directAdminTrendOptions(context) {
  const repository = getScoreRepository(context)
  if (!repository || typeof repository.listTrendOptions !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('成员账号不能查看评分趋势',403)
  return ok(repository.listTrendOptions(access.session))
}

async function directAdminTrends(context) {
  const repository = getScoreRepository(context)
  if (!repository || typeof repository.listTrends !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('成员账号不能查看评分趋势',403)
  const url = new URL(context.request.url)
  const targetType = url.searchParams.get('targetType') === 'team' ? 'team' : 'employee'
  const targetId = normalize(url.searchParams.get('targetId'))
  if (!targetId) return ok({targetType,target:null,points:[]})
  const startTime = normalize(url.searchParams.get('startTime'))
  const endTime = normalize(url.searchParams.get('endTime'))
  const start = startTime ? parseTime(startTime) : null
  const end = endTime ? parseTime(endTime) : null
  if ((startTime && !Number.isFinite(start)) || (endTime && !Number.isFinite(end)) || (start !== null && end !== null && start > end)) return fail('趋势时间范围无效')
  const result = repository.listTrends(access.session,{targetType,targetId,startTime,endTime})
  if (!result) return fail('评价对象不存在或无权查看',403)
  return ok({
    targetType,
    target:{...result.target,targetType},
    points:result.points.map((point) => ({
      activityId:point.activityId,activityName:point.activityName,periodId:point.periodId,periodName:point.periodName,
      evaluationTime:point.evaluationTime,reviewCount:point.reviewCount,total:point.total,
      status:activityStatus({status:point.status,startTime:point.startTime,endTime:point.endTime}),archived:point.archived
    }))
  })
}

async function directAdminTasks(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.listAdminTasks !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
  const url = new URL(context.request.url)
  return ok(repository.listAdminTasks(access.session,normalize(url.searchParams.get('evaluationCodeId'))))
}

async function directAdminPeriods(context, path, method) {
  const repository = getPeriodRepository(context)
  if (!repository) return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (method === 'GET') {
    if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
    return ok({items:repository.list(),canWrite:access.session.role === 'admin'})
  }
  if (access.session.role !== 'admin') return fail('只有管理员可以执行此操作',403,'FORBIDDEN')
  if (method === 'POST' && path === '/admin/periods') return ok(repository.create(await bodyJson(context.request)))
  const match = path.match(/^\/admin\/periods\/([^/]+)$/)
  if (!match) return null
  if (method === 'PUT') return ok(repository.update(match[1],await bodyJson(context.request)))
  if (method === 'DELETE') return ok(repository.delete(match[1]))
  return null
}

async function directAdminEvaluations(context, path, method) {
  const repository = getEvaluationRepository(context)
  if (!repository) return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (path === '/admin/evaluation-codes' && method === 'GET') {
    if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
    return ok(repository.list(access.session))
  }
  const match = path.match(/^\/admin\/evaluation-codes\/([^/]+)$/)
  if (!match) return null
  if (method === 'PUT') return ok(repository.update(match[1],await bodyJson(context.request),access.session))
  if (method === 'DELETE') return ok(repository.delete(match[1],access.session))
  return null
}

async function directAdminEmployees(context, path, method) {
  const repository = getEmployeeRepository(context)
  if (!repository) return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  const url = new URL(context.request.url)
  if (path === '/admin/employees' && method === 'GET') {
    if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
    return ok(repository.list(access.session,{q:url.searchParams.get('q'),teamId:url.searchParams.get('teamId'),departmentId:url.searchParams.get('departmentId'),status:url.searchParams.get('status')}))
  }
  if (path === '/admin/employees' && method === 'POST') return ok(repository.create(await bodyJson(context.request),access.session))
  const match = path.match(/^\/admin\/employees\/([^/]+)$/)
  if (!match) return null
  if (method === 'PUT') return ok(repository.update(match[1],await bodyJson(context.request),access.session))
  if (method === 'DELETE') return ok(repository.delete(match[1],access.session))
  return null
}

async function directAdminTags(context, path, method) {
  const repository = getEmployeeRepository(context)
  if (!repository) return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (path === '/admin/member-tags' && method === 'GET') {
    if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
    return ok({items:repository.listTags(access.session),canCreate:access.session.role === 'admin' || access.session.role === 'team_leader',canManage:access.session.role === 'admin'})
  }
  if (path === '/admin/member-tags' && method === 'POST') return ok(repository.createTag(await bodyJson(context.request),access.session))
  const match = path.match(/^\/admin\/member-tags\/([^/]+)$/)
  if (!match) return null
  if (method === 'PUT') return ok(repository.updateTag(match[1],await bodyJson(context.request),access.session))
  if (method === 'DELETE') return ok(repository.deleteTag(match[1],access.session))
  return null
}

async function directAdminOrganization(context, path, method) {
  const repository = getOrganizationRepository(context)
  if (!repository) return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  const match = path.match(/^\/admin\/(departments|teams)(?:\/([^/]+))?$/)
  if (!match) return null
  const kind = match[1]
  if (method === 'GET') {
    if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
    return ok(repository.list(kind,access.session))
  }
  if (method === 'POST') return ok(repository.create(kind,await bodyJson(context.request),access.session))
  if (match[2] && method === 'PUT') return ok(repository.update(kind,match[2],await bodyJson(context.request),access.session))
  if (match[2] && method === 'DELETE') return ok(repository.delete(kind,match[2],access.session))
  return null
}

async function directAdminCreateActivity(context) {
  const repository = getEvaluationRepository(context)
  if (!repository || typeof repository.createActivity !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  return ok(repository.createActivity(await bodyJson(context.request),access.session))
}


async function directAdminVerifyCodes(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.listVerifyCodes !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
  const url = new URL(context.request.url)
  return ok(repository.listVerifyCodes(access.session,normalize(url.searchParams.get('evaluationCodeId'))))
}

async function directAdminGenerateVerifyCodes(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.generateVerifyCodes !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  const input = await bodyJson(context.request)
  return ok(repository.generateVerifyCodes(input.evaluationCodeId,access.session,input))
}

async function directAdminGenerateTimedInvite(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.generateTimedInvite !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  const input = await bodyJson(context.request)
  return ok(repository.generateTimedInvite(input.evaluationCodeId,access.session))
}

async function directAdminGenerateTasks(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.generateTasks !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  const input = await bodyJson(context.request)
  return ok(repository.generateTasks(input.evaluationCodeId,access.session))
}

async function directAdminDeleteVerifyCode(context, verifyId) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.deleteVerifyCode !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  return ok(repository.deleteVerifyCode(verifyId,access.session))
}

async function directAdminDeleteTask(context, taskId) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.deleteTask !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  return ok(repository.deleteTask(taskId,access.session))
}

async function directAdminTimedInvites(context) {
  const repository = getTaskRepository(context)
  if (!repository || typeof repository.listTimedInvites !== 'function') return null
  const access = await directAdminSession(context,repository)
  if (access.response) return access.response
  if (access.session.role === 'member') return fail('当前账号没有此操作权限',403,'FORBIDDEN')
  const url = new URL(context.request.url)
  return ok(repository.listTimedInvites(access.session,normalize(url.searchParams.get('evaluationCodeId'))))
}

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return withCors(new Response(null,{status:204,headers:JSON_HEADERS}), context)
  const url = new URL(context.request.url)
  const path = url.pathname.replace(/^\/api/,'') || '/'
  const method = context.request.method.toUpperCase()
  if (!checkBodySize(context.request)) return withCors(fail('请求体过大',413,'PAYLOAD_TOO_LARGE'), context)
  const csrfDenied = requireAdminRequestHeader(context.request,path,method)
  if (csrfDenied) return withCors(csrfDenied, context)
  if (path === '/admin/login' && method === 'POST' && rateLimited(context.request,'admin-login',20,5 * 60 * 1000)) return withCors(fail('登录尝试过于频繁，请稍后再试',429,'RATE_LIMITED'), context)
  if ((path === '/public/evaluation-title' || path === '/public/verify-entry' || path === '/public/timed-entry') && method === 'POST' && rateLimited(context.request,'public-entry',40,5 * 60 * 1000)) return withCors(fail('操作过于频繁，请稍后再试',429,'RATE_LIMITED'), context)
  if (path === '/health' && method === 'GET') {
    const appEnv = getEnv(context,'APP_ENV','development')
    const production = appEnv === 'production'
    const kv = getKvBinding(context)
    let kvReadable = false
    let databasePresent = false
    if (kv) {
      try {
        const current = await kv.get(DATABASE_KEY)
        kvReadable = true
        databasePresent = current !== null && current !== undefined && current !== ''
      } catch {}
    }
    const environment = {
      appEnv,
      storageModel:getEnv(context,'STORAGE_MODEL',kv?'kv-snapshot':'memory'),
      adminSecretConfigured:Boolean(getEnv(context,'ADMIN_TOKEN_SECRET','')),
      publicSecretConfigured:Boolean(getEnv(context,'PUBLIC_TOKEN_SECRET','')),
      initialAdminPasswordConfigured:Boolean(getEnv(context,'INITIAL_ADMIN_PASSWORD',''))
    }
    const bootstrapReady = databasePresent || environment.initialAdminPasswordConfigured
    const storageReady = production ? Boolean(kv && kvReadable) : true
    const ready = Boolean(storageReady && environment.adminSecretConfigured && environment.publicSecretConfigured && (!production || bootstrapReady))
    const schemaVersion = typeof kv?.getSchemaVersion === 'function' ? kv.getSchemaVersion() : null
    return withCors(json({success:ready,data:{
      status:ready?'ok':'degraded',version:RUNTIME_VERSION,ready,uptime:Math.floor((Date.now() - runtimeStartedAt) / 1000),
      storageReady,storageType:environment.storageModel,schemaVersion,
      kvBound:Boolean(kv),kvReadable,databasePresent,bootstrapReady,environment
    },...(ready?{}:{message:'部署尚未就绪，请检查 KV 绑定和 Functions 环境变量'})},ready?200:503), context)
  }
  try {
    ensureSecrets(context)
    if ((path === '/admin/employees' || path.startsWith('/admin/employees/')) && getEmployeeRepository(context)) {
      return withCors(await directAdminEmployees(context,path,method), context)
    }
    if ((path === '/admin/member-tags' || path.startsWith('/admin/member-tags/')) && getEmployeeRepository(context)) {
      return withCors(await directAdminTags(context,path,method), context)
    }
    if (path === '/admin/departments' || path.startsWith('/admin/departments/') || path === '/admin/teams' || path.startsWith('/admin/teams/')) {
      if (getOrganizationRepository(context)) return withCors(await directAdminOrganization(context,path,method), context)
    }
    if ((path === '/admin/evaluation-codes' || path.startsWith('/admin/evaluation-codes/')) && getEvaluationRepository(context)) {
      return withCors(await directAdminEvaluations(context,path,method), context)
    }
    if (path === '/admin/evaluation-activities/create-flow' && method === 'POST' && getEvaluationRepository(context)?.createActivity) {
      return withCors(await directAdminCreateActivity(context), context)
    }
    if ((path === '/admin/periods' || path.startsWith('/admin/periods/')) && getPeriodRepository(context)) {
      return withCors(await directAdminPeriods(context,path,method), context)
    }
    if (path === '/public/timed-entry' && method === 'POST' && getTaskRepository(context)) {
      return withCors(await directTimedEntry(context), context)
    }
    if (path === '/public/current-task' && method === 'GET' && getTaskRepository(context)) {
      return withCors(await directCurrentTask(context), context)
    }
    if (path === '/public/remaining' && method === 'GET' && getTaskRepository(context)) {
      return withCors(await directRemaining(context), context)
    }
    if (path === '/admin/results' && method === 'GET' && getScoreRepository(context)?.listResults) {
      return withCors(await directAdminResults(context), context)
    }
    if (path === '/admin/trends/options' && method === 'GET' && getScoreRepository(context)?.listTrendOptions) {
      return withCors(await directAdminTrendOptions(context), context)
    }
    if (path === '/admin/trends' && method === 'GET' && getScoreRepository(context)?.listTrends) {
      return withCors(await directAdminTrends(context), context)
    }
    if (path === '/admin/tasks' && method === 'GET' && getTaskRepository(context)?.listAdminTasks) {
      return withCors(await directAdminTasks(context), context)
    }
    if (path === '/admin/verify-codes/generate' && method === 'POST' && getTaskRepository(context)?.generateVerifyCodes) {
      return withCors(await directAdminGenerateVerifyCodes(context), context)
    }
    if (path === '/admin/timed-invites/generate' && method === 'POST' && getTaskRepository(context)?.generateTimedInvite) {
      return withCors(await directAdminGenerateTimedInvite(context), context)
    }
    if (path === '/admin/tasks/generate' && method === 'POST' && getTaskRepository(context)?.generateTasks) {
      return withCors(await directAdminGenerateTasks(context), context)
    }
    const directVerifyDelete = path.match(/^\/admin\/verify-codes\/([^/]+)$/)
    if (directVerifyDelete && method === 'DELETE' && getTaskRepository(context)?.deleteVerifyCode) {
      return withCors(await directAdminDeleteVerifyCode(context,directVerifyDelete[1]), context)
    }
    const directTaskDelete = path.match(/^\/admin\/tasks\/([^/]+)$/)
    if (directTaskDelete && method === 'DELETE' && getTaskRepository(context)?.deleteTask) {
      return withCors(await directAdminDeleteTask(context,directTaskDelete[1]), context)
    }
    if (path === '/admin/verify-codes' && method === 'GET' && getTaskRepository(context)?.listVerifyCodes) {
      return withCors(await directAdminVerifyCodes(context), context)
    }
    if (path === '/admin/timed-invites' && method === 'GET' && getTaskRepository(context)?.listTimedInvites) {
      return withCors(await directAdminTimedInvites(context), context)
    }
    const db = await loadDatabase(context)
    expireTimedInvites(db)
    if (path.startsWith('/public/')) return withCors(await publicRoutes(context,path,method,db), context)
    if (path.startsWith('/admin/')) return withCors(await adminRoutes(context,path,method,db), context)
    return withCors(fail('接口不存在',404), context)
  } catch (error) {
    if (Number(error?.status)) return withCors(fail(error.message || '请求失败',error.status,error.code), context)
    logInternalError(context,error)
    const production = getEnv(context,'APP_ENV','development') === 'production'
    return withCors(fail(production ? '服务器内部错误，请检查 Functions 日志和 KV 绑定' : String(error?.stack || error),500,'INTERNAL_ERROR'), context)
  }
}
