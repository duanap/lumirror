import { randomBytes } from 'node:crypto'
export { AppError } from '../../http/errors.mjs'
export const json = (value) => JSON.stringify(value ?? null)
export const parseJson = (value, fallback = {}) => value === null || value === undefined || value === '' ? fallback : JSON.parse(value)
export const randomId = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`

export function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    if (result && typeof result.then === 'function') throw new TypeError('SQLite transactions must not contain asynchronous work')
    database.exec('COMMIT')
    return result
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* preserve the original failure */ }
    throw error
  }
}

export function touch(database, updatedAt = new Date().toISOString()) {
  database.prepare('UPDATE app_state SET updated_at=? WHERE singleton=1').run(updatedAt)
}
