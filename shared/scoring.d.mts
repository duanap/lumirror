export interface ScoringRule {
  id: string
  min: number
  max: number
  weight: number
  operation?: 'add' | 'subtract'
  enabled: boolean
}
export const ROUNDING_MODES: readonly string[]
export function calculateScore(values: Record<string, number | undefined>, rules: ScoringRule[], rounding?: string): number | null
