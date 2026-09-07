import { AsyncLocalStorage } from 'node:async_hooks'

const requestContext = new AsyncLocalStorage()

export function runWithAuditActor(actor, callback) {
  return requestContext.run({auditActor:actor || {}},callback)
}

export function currentAuditActor() {
  return requestContext.getStore()?.auditActor || {}
}
