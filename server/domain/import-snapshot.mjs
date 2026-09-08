import { randomInt } from 'node:crypto'
import { AppError } from '../http/errors.mjs'
import { prepareScoreRules } from './score-rules.mjs'
import { ROUNDING_MODES } from '../../shared/scoring.mjs'

const limits = Object.freeze({departments:1000,teams:1000,employees:5000,memberTags:1000,periods:1000,evaluationCodes:1000,verifyCodes:50000,tasks:200000,scores:200000,timedInvites:50000,logs:50000})
const fail = (message, code = 'IMPORT_INVALID') => { throw new AppError(message,400,code) }
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const unique = (value) => [...new Set((Array.isArray(value) ? value : []).map(String))]
const time = (value) => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))
const targetType = (item) => item.targetType === 'team' || item.targetTeamId ? 'team' : 'employee'
const targetId = (item) => String(item.targetId || (targetType(item) === 'team' ? item.targetTeamId : item.targetEmployeeId) || '')

// Validate all cross-collection relationships before the destructive replacement transaction.
// Account credentials are intentionally taken from the current database, never from an upload.
export function prepareImportSnapshot(input, currentUsers) {
  if (!plain(input)) fail('导入数据必须是 JSON 对象')
  if (input.restorable === false || input.format === 'lumirror-statistics-v1') fail('统计报告不是备份，不能用于恢复','NOT_A_BACKUP')
  const version = Number(input.version || 1)
  if (!Number.isInteger(version) || version < 1 || version > 4 || Number(input.schemaVersion || 0) > 4) fail('备份版本不受支持','UNSUPPORTED_BACKUP_VERSION')
  const data = structuredClone(input)
  const maps = {}
  for (const [key,max] of Object.entries(limits)) {
    if (data[key] === undefined && ['memberTags','timedInvites','logs'].includes(key)) data[key] = []
    if (!Array.isArray(data[key])) fail(`Missing ${key} array`)
    if (data[key].length > max) throw new AppError(`${key} exceeds import limit`,413,'IMPORT_TOO_LARGE')
    const map = new Map()
    for (const item of data[key]) {
      if (!plain(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || map.has(item.id)) fail(`Invalid or duplicate ${key} id`)
      map.set(item.id,item)
    }
    maps[key] = map
  }
  const requireRef = (key,id,label) => { if (!maps[key].has(id)) fail(`Invalid ${label} reference`) }
  for (const team of data.teams) requireRef('departments',team.departmentId,'team department')
  const tagNames = new Set()
  for (const tag of data.memberTags) {
    tag.name = String(tag.name || '').trim().replace(/\s+/g,' ')
    const key = tag.name.toLocaleLowerCase('zh-CN')
    if (!tag.name || tag.name.length > 20 || tagNames.has(key)) fail('Invalid or duplicate member tag name')
    tagNames.add(key)
  }
  for (const employee of data.employees) {
    requireRef('teams',employee.teamId,'employee team')
    requireRef('departments',employee.departmentId,'employee department')
    if (maps.teams.get(employee.teamId).departmentId !== employee.departmentId) fail('Employee team and department are inconsistent')
    delete employee.phone
    delete employee.employeeNo
    employee.tagIds = unique(employee.tagIds)
    for (const id of employee.tagIds) requireRef('memberTags',id,'employee tag')
  }
  for (const period of data.periods) if (!time(period.startTime) || !time(period.endTime) || Date.parse(period.startTime) >= Date.parse(period.endTime)) fail('Invalid period date range')
  const linkCodes = new Set()
  const evaluationCodes = new Set()
  for (const evaluation of data.evaluationCodes) {
    requireRef('teams',evaluation.teamId,'evaluation team')
    requireRef('departments',evaluation.departmentId,'evaluation department')
    requireRef('periods',evaluation.periodId,'evaluation period')
    if (!time(evaluation.startTime) || !time(evaluation.endTime) || Date.parse(evaluation.startTime) >= Date.parse(evaluation.endTime)) fail('Invalid evaluation date range')
    if (maps.teams.get(evaluation.teamId).departmentId !== evaluation.departmentId) fail('Evaluation team and department are inconsistent')
    if (!evaluation.code || evaluationCodes.has(evaluation.code)) fail('Invalid or duplicate evaluation code')
    evaluationCodes.add(evaluation.code)
    if (!evaluation.linkCode) {
      do { evaluation.linkCode = Array.from({length:8},() => randomInt(10)).join('') } while (linkCodes.has(evaluation.linkCode))
    }
    if (linkCodes.has(evaluation.linkCode)) fail('Duplicate invitation link')
    linkCodes.add(evaluation.linkCode)
    if (!['active','disabled','archived'].includes(evaluation.status || 'active')) fail('Invalid evaluation status')
    evaluation.targetType = evaluation.targetType === 'team' ? 'team' : 'employee'
    evaluation.rules = prepareScoreRules(evaluation.rules)
    evaluation.rounding ||= 'one_decimal'
    if (!ROUNDING_MODES.includes(evaluation.rounding)) fail('Invalid rounding mode')
    evaluation.targetEmployeeIds = unique(evaluation.targetEmployeeIds)
    evaluation.targetTeamIds = unique(evaluation.targetTeamIds)
    evaluation.participantEmployeeIds = unique(evaluation.participantEmployeeIds)
    for (const id of evaluation.targetEmployeeIds) requireRef('employees',id,'evaluation target employee')
    for (const id of evaluation.targetTeamIds) requireRef('teams',id,'evaluation target team')
    for (const id of evaluation.participantEmployeeIds) requireRef('employees',id,'evaluation participant')
  }
  const verifyHashes = new Set()
  for (const verify of data.verifyCodes) {
    requireRef('evaluationCodes',verify.evaluationCodeId,'verification evaluation')
    if (verify.participantEmployeeId) requireRef('employees',verify.participantEmployeeId,'verification participant')
    if (!/^[a-f0-9]{64}$/i.test(verify.codeHash || '') || !/^[a-f0-9]{64}$/i.test(verify.codeFingerprint || '')) fail('邀请码哈希缺失或已脱敏','NOT_A_BACKUP')
    const key = `${verify.evaluationCodeId}:${verify.codeHash}`
    if (verifyHashes.has(key)) fail('Duplicate verification hash')
    verifyHashes.add(key)
    // A legacy full backup may contain a plaintext code; never persist it on import.
    const suffix = String(verify.suffix || verify.code || '').slice(-2)
    delete verify.code
    verify.codeMask = suffix ? `****${suffix}` : '******'
    verify.participantEmployeeId ||= ''
  }
  const progress = new Map()
  const taskTargets = new Set()
  for (const task of data.tasks) {
    requireRef('evaluationCodes',task.evaluationCodeId,'task evaluation')
    requireRef('verifyCodes',task.verifyCodeId,'task verification')
    if (maps.verifyCodes.get(task.verifyCodeId).evaluationCodeId !== task.evaluationCodeId) fail('Task crosses evaluation boundary')
    task.targetType = targetType(task)
    task.targetId = targetId(task)
    requireRef(task.targetType === 'team' ? 'teams' : 'employees',task.targetId,'task target')
    if (!['pending','submitted'].includes(task.status)) fail('Invalid task status')
    const targetKey = JSON.stringify([task.verifyCodeId,task.targetType,task.targetId])
    if (taskTargets.has(targetKey)) fail('Duplicate target for one invitation')
    taskTargets.add(targetKey)
    const value = progress.get(task.verifyCodeId) || {expected:0,submitted:0}
    value.expected++
    if (task.status === 'submitted') value.submitted++
    progress.set(task.verifyCodeId,value)
  }
  const scoredTasks = new Set()
  for (const score of data.scores) {
    requireRef('tasks',score.taskId,'score task')
    const task = maps.tasks.get(score.taskId)
    score.targetType = score.targetType || task.targetType
    score.targetId = targetId(score) || task.targetId
    if (score.evaluationCodeId !== task.evaluationCodeId || score.targetType !== task.targetType || score.targetId !== task.targetId || task.status !== 'submitted') fail('Score and task are inconsistent')
    if (scoredTasks.has(score.taskId) || !Number.isFinite(score.total) || !time(score.createdAt) || !plain(score.values)) fail('Invalid or duplicate score')
    if (Object.entries(score.values).some(([key,value]) => ['__proto__','constructor','prototype'].includes(key) || !Number.isFinite(value))) fail('Invalid score values')
    scoredTasks.add(score.taskId)
  }
  for (const task of data.tasks) if (task.status === 'submitted' && !scoredTasks.has(task.id)) fail('Submitted task is missing its score')
  for (const verify of data.verifyCodes) {
    const value = progress.get(verify.id) || {expected:0,submitted:0}
    Object.assign(verify,value,{remaining:value.expected-value.submitted})
    if (!['locked','disabled'].includes(verify.status)) verify.status = value.expected > 0 && verify.remaining === 0 ? 'completed' : verify.firstUsedAt ? 'in_progress' : 'unused'
  }
  for (const invite of data.timedInvites) {
    requireRef('verifyCodes',invite.verifyCodeId,'timed invitation verification')
    if (maps.verifyCodes.get(invite.verifyCodeId).evaluationCodeId !== invite.evaluationCodeId) fail('Timed invitation crosses evaluation boundary')
    if (!invite.linkCode || linkCodes.has(invite.linkCode) || (invite.expiresAt && !time(invite.expiresAt))) fail('Invalid timed invitation link or expiry')
    linkCodes.add(invite.linkCode)
  }
  data.users = structuredClone(currentUsers)
  for (const user of data.users) {
    if (user.departmentId) requireRef('departments',user.departmentId,'retained account department')
    if (user.teamId) requireRef('teams',user.teamId,'retained account team')
    if (user.employeeId) requireRef('employees',user.employeeId,'retained account employee')
  }
  data.admins = []
  data.version = 4
  data.settings ||= {systemName:'和光镜鉴',publicSessionMinutes:120,logRetentionDays:90}
  const settings = data.settings
  if (!plain(settings) || !String(settings.systemName || '').trim() || String(settings.systemName).length > 40 || !Number.isInteger(settings.publicSessionMinutes) || settings.publicSessionMinutes < 5 || settings.publicSessionMinutes > 240 || !Number.isInteger(settings.logRetentionDays) || settings.logRetentionDays < 7 || settings.logRetentionDays > 3650) fail('Invalid imported settings')
  for (const log of data.logs) if (!time(log.createdAt) || !String(log.action || '').trim()) fail('Invalid audit log')
  return data
}
