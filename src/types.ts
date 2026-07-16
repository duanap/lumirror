export interface ScoreRule {
  id: string
  name: string
  min: number
  max: number
  weight: number
  enabled: boolean
}

export interface Employee {
  id: string
  name: string
  gender: 'male' | 'female' | 'unknown'
  departmentId: string
  departmentName?: string
  teamId: string
  teamName?: string
  position: string
  status: 'active' | 'inactive'
  avatar?: string
}

export type BackendRole = 'admin' | 'team_leader' | 'leader' | 'member'

export interface BackendUser {
  id: string
  username: string
  displayName: string
  role: BackendRole
  roleLabel: string
  status: 'active' | 'inactive'
  teamId?: string
  departmentId?: string
  employeeId?: string
  permissions: string[]
  mustChangePassword?: boolean
}

export interface EvaluationTask {
  id: string
  target: Employee
  evaluation: { id: string; name: string; code: string; teamName: string }
  rules: ScoreRule[]
  rounding: 'round' | 'one_decimal' | 'floor'
  remaining: number
  timed?: boolean
  expiresAt?: string | null
}

export interface ApiResult<T = unknown> {
  success: boolean
  data?: T
  message?: string
  token?: string
  user?: BackendUser
  evaluation?: Record<string, unknown>
  remaining?: number
  timed?: boolean
  expiresAt?: string | null
}
