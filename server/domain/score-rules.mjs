import { AppError } from '../http/errors.mjs'

export function prepareScoreRules(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 12) throw new AppError('评分维度数量必须为 1-12 个')
  if (input.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new AppError('Invalid score rule')
  const rules = input.map((item,index) => ({id:String(item.id || `dimension_${index+1}`).trim(),name:String(item.name || '').trim(),min:Number(item.min),max:Number(item.max),weight:Number(item.weight),operation:item.operation === 'subtract' ? 'subtract' : 'add',enabled:Boolean(item.enabled)}))
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length || rules.some((rule) => !/^[A-Za-z0-9_-]{1,48}$/.test(rule.id) || ['__proto__','prototype','constructor'].includes(rule.id))) throw new AppError('评分维度标识无效或重复')
  if (rules.some((rule) => !rule.name || rule.name.length > 30)) throw new AppError('评分维度名称需为 1-30 个字符')
  if (rules.some((rule) => !Number.isInteger(rule.min) || !Number.isInteger(rule.max) || rule.min < 0 || rule.max > 99 || rule.min >= rule.max)) throw new AppError('评分范围必须是 0-99 内递增的整数')
  if (rules.some((rule) => !Number.isInteger(rule.weight) || rule.weight < 0 || rule.weight > 100)) throw new AppError('计入比例必须是 0-100 的整数')
  const enabled = rules.filter((rule) => rule.enabled)
  if (!enabled.length) throw new AppError('至少启用 1 个评分维度')
  const equalAverage = enabled.every((rule) => rule.operation === 'add' && rule.weight === 100)
  if (!equalAverage && enabled.reduce((sum,rule) => sum+(rule.operation === 'subtract' ? -1 : 1)*rule.weight,0) !== 100) throw new AppError('启用维度的净计入比例必须为 100%，或全部使用 100% 等权平均')
  return rules
}
