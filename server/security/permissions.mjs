export const ROLE_LABELS = Object.freeze({admin:'管理员',team_leader:'团队长',leader:'领导',member:'成员'})
export const ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  team_leader: ['dashboard:view','employees:view','employees:write','activities:view','activities:write','verify:view','verify:write','tasks:view','tasks:write','results:view','periods:view','settings:password'],
  leader: ['dashboard:view','employees:view','activities:view','verify:view','tasks:view','results:view','periods:view','settings:password'],
  member: ['dashboard:view','settings:password']
})
export function can(session, permission) {
  const permissions = ROLE_PERMISSIONS[session?.role] || []
  return permissions.includes('*') || permissions.includes(permission)
}
export function userView(user) {
  return {
    id:user.id, username:user.username, displayName:user.displayName, role:user.role,
    roleLabel:ROLE_LABELS[user.role] || user.role, status:user.status,
    teamId:user.teamId || '', departmentId:user.departmentId || '', employeeId:user.employeeId || '',
    permissions:[...(ROLE_PERMISSIONS[user.role] || [])], mustChangePassword:Boolean(user.mustChangePassword),
    createdAt:user.createdAt, updatedAt:user.updatedAt
  }
}
