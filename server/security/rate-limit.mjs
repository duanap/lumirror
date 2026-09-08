import { createHmac } from 'node:crypto'
import { AppError } from '../http/errors.mjs'

export class RateLimiter {
  constructor({capacity = 10000, now = Date.now} = {}) {
    this.capacity = capacity
    this.now = now
    this.buckets = new Map()
    this.nextSweep = 0
  }
  check(key, limit) {
    const bucket = this.buckets.get(key)
    if (bucket && bucket.resetAt > this.now() && bucket.count >= limit) {
      const error = new AppError('Too many attempts; try again later',429,'RATE_LIMITED')
      error.retryAfter = Math.max(1,Math.ceil((bucket.resetAt-this.now())/1000))
      throw error
    }
  }
  forget(key) { this.buckets.delete(key) }
  take(key, limit, windowMs) {
    const now = this.now()
    if (now >= this.nextSweep || this.buckets.size >= this.capacity) {
      for (const [id,bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(id)
      this.nextSweep = now+30000
    }
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= this.capacity) throw new AppError('请求过多，请稍后再试',429,'RATE_LIMITED')
      bucket = {count:0,resetAt:now+windowMs}
      this.buckets.set(key,bucket)
    }
    bucket.count += 1
    if (bucket.count > limit) {
      const error = new AppError('操作过于频繁，请稍后再试',429,'RATE_LIMITED')
      error.retryAfter = Math.max(1,Math.ceil((bucket.resetAt-now)/1000))
      throw error
    }
  }
}
export function rateKey(secret, ...parts) {
  return createHmac('sha256',secret).update(JSON.stringify(parts)).digest('hex')
}
