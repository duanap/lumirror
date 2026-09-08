import { AppError } from './errors.mjs'
export const MAX_BODY_BYTES = 2*1024*1024
export function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('请求内容必须是 JSON 对象',400,'INVALID_JSON')
  const pending = [[value,0]]
  let visited = 0
  while (pending.length) {
    const [item,depth] = pending.pop()
    if (++visited > 250000 || depth > 32) throw new AppError('JSON structure is too complex',400,'INVALID_JSON')
    for (const entry of Object.values(item)) if (entry !== null && typeof entry === 'object') pending.push([entry,depth+1])
  }
  return value
}
export async function bodyJson(request) {
  const mediaType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (mediaType && mediaType !== 'application/json') throw new AppError('请使用 application/json',415,'UNSUPPORTED_MEDIA_TYPE')
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AppError('请求体过大',413,'PAYLOAD_TOO_LARGE')
  try { return objectBody(text.trim() ? JSON.parse(text) : {}) }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('请求 JSON 格式无效',400,'INVALID_JSON') }
}
export function dateFields(input) {
  const output = {...input}
  for (const key of ['startTime','endTime']) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string' || !input[key].trim() || !Number.isFinite(Date.parse(input[key]))) throw new AppError('开始或结束时间无效',400,'INVALID_DATE')
    output[key] = new Date(input[key]).toISOString()
  }
  if (output.startTime && output.endTime && output.startTime >= output.endTime) throw new AppError('结束时间必须晚于开始时间',400,'INVALID_DATE')
  return output
}
export function integerQuery(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new AppError('分页参数无效',400,'INVALID_PAGINATION')
  return parsed
}
