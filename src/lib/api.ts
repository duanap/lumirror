import type { ApiResult } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const DEFAULT_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  status: number
  code: string
  requestId: string
  constructor(message: string, status = 500, code = 'REQUEST_FAILED', requestId = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = path.startsWith('/admin') ? '' : sessionStorage.getItem('public_token')
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (path.startsWith('/admin') && (options.method || 'GET').toUpperCase() !== 'GET') headers.set('X-Lumirror-Request', 'fetch')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const controller = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, DEFAULT_TIMEOUT_MS)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once:true })
  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal:controller.signal, cache:'no-store', credentials:'include' })
    } catch (error) {
      if (timedOut) throw new ApiError('请求超时，请稍后重试',0,'TIMEOUT')
      if (options.signal?.aborted) throw new ApiError('请求已取消',0,'REQUEST_ABORTED')
      throw new ApiError('网络连接失败，请检查网络后重试',0,'NETWORK_ERROR')
    }
    const isJson = response.headers.get('content-type')?.includes('application/json')
    const payload: any = isJson ? await response.json() : await response.text()
    const requestId = String(payload?.requestId || response.headers.get('x-request-id') || '')
    if (!response.ok || (isJson && payload?.success === false)) {
      throw new ApiError(
        String(payload?.message || `请求失败（${response.status}）`),
        response.status,
        String(payload?.code || 'REQUEST_FAILED'),
        requestId
      )
    }
    return payload as T
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort',abort)
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<ApiResult<T>>(path,{signal}),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<ApiResult<T>>(path, { method:'POST', body:body === undefined ? undefined : JSON.stringify(body), signal }),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<ApiResult<T>>(path, { method:'PUT', body:JSON.stringify(body), signal }),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<ApiResult<T>>(path, { method:'PATCH', body:JSON.stringify(body), signal }),
  delete: <T>(path: string, signal?: AbortSignal) => request<ApiResult<T>>(path, { method:'DELETE', signal }),
  raw: (path: string) => fetch(`${API_BASE}${path}`, { credentials:'include' })
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (result.data === undefined) throw new ApiError(result.message || '返回数据为空',500,'EMPTY_RESPONSE')
  return result.data
}
