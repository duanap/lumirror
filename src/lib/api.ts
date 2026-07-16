import type { ApiResult } from '../types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = path.startsWith('/admin') ? '' : sessionStorage.getItem('public_token')
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  if (path.startsWith('/admin') && (options.method || 'GET').toUpperCase() !== 'GET') headers.set('X-Lumirror-Request', 'fetch')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: 'no-store', credentials: 'include' })
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()
  if (!response.ok || (isJson && payload.success === false)) {
    throw new ApiError(payload?.message || `请求失败（${response.status}）`, response.status)
  }
  return payload as T
}

export const api = {
  get: <T>(path: string) => request<ApiResult<T>>(path),
  post: <T>(path: string, body?: unknown) => request<ApiResult<T>>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<ApiResult<T>>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<ApiResult<T>>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<ApiResult<T>>(path, { method: 'DELETE' }),
  raw: (path: string) => fetch(`${API_BASE}${path}`, { credentials: 'include' })
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (result.data === undefined) throw new ApiError(result.message || '返回数据为空')
  return result.data
}
