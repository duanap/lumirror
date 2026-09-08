export const ROUNDING_MODES = Object.freeze(['round','floor','one_decimal'])

export function calculateScore(values, rules, rounding = 'round') {
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Array.isArray(rules) || !ROUNDING_MODES.includes(rounding)) return null
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) return null
  for (const rule of enabled) {
    const value = values[rule.id]
    if (!Object.hasOwn(values,rule.id) || !Number.isInteger(value) || value < rule.min || value > rule.max) return null
    if (!Number.isInteger(Number(rule.weight)) || Number(rule.weight) < 0 || Number(rule.weight) > 100 || !['add','subtract'].includes(rule.operation || 'add')) return null
  }
  const equalAverage = enabled.every((rule) => (rule.operation || 'add') === 'add' && Number(rule.weight) === 100)
  const netWeight = enabled.reduce((sum,rule) => sum + ((rule.operation || 'add') === 'subtract' ? -1 : 1) * Number(rule.weight),0)
  if (!equalAverage && netWeight !== 100) return null
  const result = equalAverage
    ? enabled.reduce((sum,rule) => sum+values[rule.id],0)/enabled.length
    : enabled.reduce((sum,rule) => sum+((rule.operation || 'add') === 'subtract' ? -1 : 1)*values[rule.id]*Number(rule.weight)/100,0)
  if (!Number.isFinite(result)) return null
  if (rounding === 'one_decimal') return Math.round(result*10)/10
  return rounding === 'floor' ? Math.floor(result) : Math.round(result)
}
