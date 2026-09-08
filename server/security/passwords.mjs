import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AppError } from '../http/errors.mjs'

export const PASSWORD_ALGORITHM = 'pbkdf2-sha256'
export const PASSWORD_ITERATIONS = 210000
const derive = promisify(pbkdf2)
const MAX_PASSWORD_BYTES = 1024
const MAX_ACTIVE = 4
const MAX_WAITING = 32
let active = 0
const waiting = []

// Only expensive password work is bounded; ordinary HTTP/SQLite requests are never serialized here.
async function withPasswordSlot(operation) {
  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_WAITING) throw new AppError('认证服务繁忙，请稍后重试',503,'AUTH_BUSY')
    await new Promise((resolve) => waiting.push(resolve))
  } else active += 1
  try { return await operation() }
  finally {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
}

export function validatePassword(password, minimum = 0) {
  if (typeof password !== 'string' || password.length < minimum || Buffer.byteLength(password,'utf8') > MAX_PASSWORD_BYTES) {
    throw new AppError(`密码至少 ${minimum} 个字符，且不能超过 ${MAX_PASSWORD_BYTES} 字节`,400,'INVALID_PASSWORD')
  }
  return password
}

export async function hashPassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  validatePassword(password)
  const rounds = Number(iterations)
  if (!Number.isInteger(rounds) || rounds < 10000 || rounds > 1000000) throw new AppError('密码参数无效',500,'PASSWORD_PARAMETERS_INVALID')
  return withPasswordSlot(async () => (await derive(password,String(salt),rounds,32,'sha256')).toString('hex'))
}

function equalHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left)) || !/^[a-f0-9]{64}$/i.test(String(right))) return false
  return timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'))
}

export async function verifyPassword(password, user) {
  validatePassword(password)
  if (!user?.salt || !user?.passwordHash) {
    // Keep nonexistent-user login attempts on the same expensive path.
    await hashPassword(password,'lumirror-invalid-account')
    return false
  }
  if (user.passwordAlgorithm === PASSWORD_ALGORITHM) {
    return equalHex(await hashPassword(password,user.salt,Number(user.passwordIterations || PASSWORD_ITERATIONS)),user.passwordHash)
  }
  if (!user.passwordAlgorithm || user.passwordAlgorithm === 'legacy-sha256') {
    return equalHex(createHash('sha256').update(`${user.salt}:${password}:employee-review`).digest('hex'),user.passwordHash)
  }
  return false
}

export async function passwordFields(password, forceChange = false) {
  validatePassword(password,8)
  const salt = randomBytes(16).toString('hex')
  return {
    salt, passwordHash:await hashPassword(password,salt), passwordAlgorithm:PASSWORD_ALGORITHM,
    passwordIterations:PASSWORD_ITERATIONS, mustChangePassword:Boolean(forceChange)
  }
}

export const credentialIdentity = (user) => [user?.salt,user?.passwordHash,user?.passwordAlgorithm,user?.passwordIterations].join(':')
