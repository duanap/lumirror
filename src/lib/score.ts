import type { ScoreRule } from '../types'

export function calculateScore(values: Record<string, number | undefined>, rules: ScoreRule[], rounding = 'round') {
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) return null
  for (const rule of enabled) {
    const value = values[rule.id]
    if (!Number.isInteger(value) || Number(value) < rule.min || Number(value) > rule.max) return null
  }
  const weights = enabled.map((rule) => Number(rule.weight))
  const score = weights.every((weight) => weight === 100)
    ? enabled.reduce((total, rule) => total + Number(values[rule.id]), 0) / enabled.length
    : enabled.reduce((total, rule) => total + Number(values[rule.id]) * rule.weight / 100, 0)
  if (rounding === 'one_decimal') return Math.round(score * 10) / 10
  if (rounding === 'floor') return Math.floor(score)
  return Math.round(score)
}

export function ruleFormula(rules: ScoreRule[]) {
  const enabled = rules.filter((rule) => rule.enabled)
  if (enabled.length && enabled.every((rule) => Number(rule.weight) === 100)) return `等权平均：(${enabled.map((rule) => rule.name).join(' + ')}) / ${enabled.length}`
  return enabled.map((rule) => `${rule.name} ${rule.weight}%`).join(' + ')
}
