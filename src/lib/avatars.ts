import type { CSSProperties } from 'vue'

export type AvatarGender = 'male' | 'female'

export interface AvatarPreset {
  id: string
  gender: AvatarGender
  label: string
  x: number
  y: number
}

const SPRITE_SIZE = 1254
const AVATAR_SIZE = 280

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id:'avatar_male_young_plain', gender:'male', label:'头像 1', x:112, y:320 },
  { id:'avatar_male_young_glasses', gender:'male', label:'头像 2', x:415, y:320 },
  { id:'avatar_male_adult_plain', gender:'male', label:'头像 3', x:112, y:645 },
  { id:'avatar_male_adult_glasses', gender:'male', label:'头像 4', x:415, y:645 },
  { id:'avatar_female_young_plain', gender:'female', label:'头像 1', x:687, y:320 },
  { id:'avatar_female_young_glasses', gender:'female', label:'头像 2', x:970, y:320 },
  { id:'avatar_female_adult_plain', gender:'female', label:'头像 3', x:687, y:645 },
  { id:'avatar_female_adult_glasses', gender:'female', label:'头像 4', x:970, y:645 }
]

export function avatarPresetById(value?: string) {
  return AVATAR_PRESETS.find((item) => item.id === value)
}

export function avatarSpriteStyle(preset: AvatarPreset, size: number): CSSProperties {
  const scale = size / AVATAR_SIZE
  return {
    backgroundImage: "url('/assets/avatar/avatar-sprite.png')",
    backgroundSize: `${SPRITE_SIZE * scale}px ${SPRITE_SIZE * scale}px`,
    backgroundPosition: `${-preset.x * scale}px ${-preset.y * scale}px`
  }
}
