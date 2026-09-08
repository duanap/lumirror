export function activityStatus(evaluation, now = Date.now()) {
  if (['disabled','archived'].includes(evaluation.status)) return evaluation.status
  const start = Date.parse(evaluation.startTime ?? evaluation.start_time)
  const end = Date.parse(evaluation.endTime ?? evaluation.end_time)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return 'invalid'
  if (now < start) return 'upcoming'
  if (now > end) return 'ended'
  return 'active'
}
