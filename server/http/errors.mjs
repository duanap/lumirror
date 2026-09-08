export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}

export function normalizeError(error) {
  const busy = [5,6].includes(Number(error?.errcode) & 255)
  const value = busy ? 503 : Number(error?.status)
  const status = Number.isInteger(value) && value >= 400 && value <= 599 ? value : 500
  const code = busy ? 'DATABASE_BUSY' : typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
  return {
    status,
    code,
    message: status >= 500
      ? '服务器内部错误，请提供请求编号联系管理员'
      : String(error?.message || '请求失败')
  }
}

// Do not serialize exception messages containing request input, SQL parameters or credentials.
export function errorLogRecord(error, requestId) {
  const normalized = normalizeError(error)
  const stack = String(error?.stack || '').split('\n').filter((line) => /^\s+at\s/.test(line)).slice(0, 8)
  return {
    timestamp: new Date().toISOString(), requestId, level: 'error',
    errorType: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(String(error?.name || '')) ? error.name : 'Error', errorCode: normalized.code,
    sqliteCode: Number.isInteger(error?.errcode) ? error.errcode : undefined,
    stack
  }
}
