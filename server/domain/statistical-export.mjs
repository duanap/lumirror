const round = (value) => Math.round(value*10)/10
const targetType = (item) => item.targetType === 'team' || item.targetTeamId ? 'team' : 'employee'
const targetId = (item) => String(item.targetId || (targetType(item) === 'team' ? item.targetTeamId : item.targetEmployeeId) || '')

// This is a shareable statistical report, NOT a redacted database or a restorable backup.
// No object spreads: adding a field to a stored entity cannot silently add it to an export.
export function buildStatisticalExport(database, {minimumSampleSize = 3, now = Date.now()} = {}) {
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 3) throw new RangeError('minimumSampleSize must be at least 3')
  const activities = new Map((database.evaluationCodes || []).filter((item) => {
    const end = Date.parse(item.endTime)
    return item.status === 'archived' || Number.isFinite(end) && end <= now
  }).map((item) => [item.id,item]))
  const employees = new Map((database.employees || []).map((item) => [item.id,item]))
  const teams = new Map((database.teams || []).map((item) => [item.id,item]))
  const periods = new Map((database.periods || []).map((item) => [item.id,item]))
  const tasks = new Map((database.tasks || []).map((item) => [item.id,item]))
  const verifies = new Map((database.verifyCodes || []).map((item) => [item.id,item]))
  const groups = new Map()
  for (const score of database.scores || []) {
    if (!activities.has(score.evaluationCodeId)) continue
    const type = targetType(score)
    const id = targetId(score)
    if (!(type === 'team' ? teams : employees).has(id)) continue
    const key = JSON.stringify([score.evaluationCodeId,type,id])
    if (!groups.has(key)) groups.set(key,[])
    groups.get(key).push(score)
  }
  const items = []
  let suppressedGroups = 0
  for (const [key,scores] of groups) {
    const reviewers = scores.map((score) => {
      const verify = verifies.get(tasks.get(score.taskId)?.verifyCodeId)
      return verify ? (verify.participantEmployeeId ? `member:${verify.participantEmployeeId}` : `invite:${verify.id}`) : null
    })
    // Repeated invitations for one named participant must never inflate the privacy threshold.
    if (reviewers.includes(null) || new Set(reviewers).size !== scores.length || scores.length < minimumSampleSize || scores.some((score) => !Number.isFinite(score.total))) {
      suppressedGroups += 1
      continue
    }
    const [evaluationId,type,id] = JSON.parse(key)
    const activity = activities.get(evaluationId)
    const target = (type === 'team' ? teams : employees).get(id)
    const dimensions = []
    for (const rule of (activity.rules || []).filter((rule) => rule.enabled)) {
      const values = scores.map((score) => score.values?.[rule.id])
      // Never publish a dimension whose mean is based on fewer people than the group.
      dimensions.push({name:String(rule.name),average:values.every(Number.isFinite) ? round(values.reduce((sum,value) => sum+value,0)/values.length) : null})
    }
    items.push({
      activityName:String(activity.name), periodName:String(periods.get(activity.periodId)?.name || ''),
      targetType:type, targetName:String(scores[0].targetSnapshot?.name || target.name), reviewCount:scores.length,
      average:round(scores.reduce((sum,score) => sum+score.total,0)/scores.length), dimensions
    })
  }
  items.sort((a,b) => a.activityName.localeCompare(b.activityName) || a.targetName.localeCompare(b.targetName))
  return {
    format:'lumirror-statistics-v1',restorable:false,generatedAt:new Date(now).toISOString(),
    minimumSampleSize,scope:'closed-activities-only',suppressedGroups,items
  }
}
