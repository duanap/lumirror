import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { handleNodeDirectRoute } from '../node-direct-routes.mjs'
import { AppError, normalizeError, errorLogRecord } from './errors.mjs'
import { MAX_BODY_BYTES } from './validation.mjs'
import { jsonResponse, responseHeaders } from './responses.mjs'

function headersOf(req) {
  const headers = new Headers()
  for (const [name,value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name,item))
    else if (value !== undefined) headers.set(name,value)
  }
  return headers
}
export function trustedClientAddress(req,env) {
  const remote = req.socket.remoteAddress || 'unknown'
  const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)
  const forwarded = String(req.headers['x-real-ip'] || '').trim()
  return env.TRUST_PROXY !== 'false' && loopback && isIP(forwarded) ? forwarded : remote
}
function readBody(req) {
  if (['GET','HEAD'].includes(req.method)) return Promise.resolve(undefined)
  const length = Number(req.headers['content-length'] || 0)
  if (length > MAX_BODY_BYTES) return Promise.reject(new AppError('请求体过大',413,'PAYLOAD_TOO_LARGE'))
  return new Promise((resolve,reject) => {
    const chunks = []
    let size = 0
    let rejected = false
    req.on('data',(chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) { rejected = true; chunks.length = 0; reject(new AppError('请求体过大',413,'PAYLOAD_TOO_LARGE')); return }
      chunks.push(chunk)
    })
    req.once('end',() => { if (!rejected) resolve(chunks.length ? Buffer.concat(chunks) : undefined) })
    req.once('error',reject)
    req.once('aborted',() => reject(new AppError('Request aborted',400,'REQUEST_ABORTED')))
  })
}
export function createRequestHandler(env,{dispatch = handleNodeDirectRoute,logger = console} = {}) {
  return async (req,res) => {
    const started = performance.now()
    const requestId = randomUUID()
    const ctx = {env,requestId,routeTemplate:'/api/[unmatched]',clientAddress:trustedClientAddress(req,env),actor:null}
    let status = 500, errorCode = null
    try {
      const headers = headersOf(req)
      const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      const proto = loopback && env.TRUST_PROXY !== 'false' && headers.get('x-forwarded-proto') === 'https' ? 'https' : 'http'
      const host = headers.get('host') || 'localhost'
      const body = await readBody(req)
      ctx.request = new Request(`${proto}://${host}${req.url || '/'}`,{method:req.method,headers,body})
      const result = await dispatch(ctx)
      if (!(result instanceof Response)) throw new Error('HTTP route did not return a Response')
      const response = responseHeaders(result,ctx)
      status = response.status
      const bytes = Buffer.from(await response.arrayBuffer())
      const outputHeaders = Object.fromEntries(response.headers)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) outputHeaders['set-cookie'] = cookies
      if (!res.destroyed) { res.writeHead(status,outputHeaders); res.end(req.method === 'HEAD' ? undefined : bytes) }
    } catch (error) {
      const normalized = normalizeError(error)
      status = normalized.status
      errorCode = normalized.code
      if (status >= 500) logger.error(JSON.stringify(errorLogRecord(error,requestId)))
      if (res.headersSent) { res.end(); return }
      if (res.destroyed) return
      const extra = {'x-request-id':requestId}
      if (error.retryAfter || status === 429 || normalized.code === 'DATABASE_BUSY') extra['retry-after'] = String(Math.max(1,Math.ceil(Number(error.retryAfter) || (status === 429 ? 60 : 1))))
      if (error.allow) extra.allow = error.allow
      if (status === 413) extra.connection = 'close'
      let response = jsonResponse({success:false,...normalized,requestId},status,extra)
      if (ctx.request) response = responseHeaders(response,ctx)
      res.writeHead(status,Object.fromEntries(response.headers))
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
      if (status === 413) res.once('finish',() => req.destroy())
    } finally {
      const durationMs = Math.round((performance.now()-started)*100)/100
      logger.log(JSON.stringify({timestamp:new Date().toISOString(),requestId,method:req.method || 'GET',route:ctx.routeTemplate,status,durationMs,userRole:ctx.actor?.role || 'anonymous',errorCode,level:status>=500 ? 'error' : status>=400 || durationMs>500 ? 'warn' : 'info'}))
    }
  }
}
