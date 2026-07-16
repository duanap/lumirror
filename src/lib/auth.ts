import type { BackendUser } from '../types'

const USER_KEY = 'admin_user'

export function getStoredUser(): BackendUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as BackendUser : null
  } catch {
    return null
  }
}

export function storeUser(user: BackendUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem(USER_KEY)
}

export function can(user: BackendUser | null, permission: string) {
  if (!user) return false
  return user.permissions.includes('*') || user.permissions.includes(permission)
}
