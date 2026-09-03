export type AvatarGender = 'male' | 'female'

export interface AvatarPreset {
  id: string
  gender: AvatarGender
  label: string
  src: string
  thumbSrc: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id:'avatar_male_young_plain', gender:'male', label:'头像 1', src:'/assets/avatar/male-1.webp', thumbSrc:'/assets/avatar/male-1-thumb.webp' },
  { id:'avatar_male_young_glasses', gender:'male', label:'头像 2', src:'/assets/avatar/male-2.webp', thumbSrc:'/assets/avatar/male-2-thumb.webp' },
  { id:'avatar_male_adult_plain', gender:'male', label:'头像 3', src:'/assets/avatar/male-3.webp', thumbSrc:'/assets/avatar/male-3-thumb.webp' },
  { id:'avatar_male_adult_glasses', gender:'male', label:'头像 4', src:'/assets/avatar/male-4.webp', thumbSrc:'/assets/avatar/male-4-thumb.webp' },
  { id:'avatar_female_young_plain', gender:'female', label:'头像 1', src:'/assets/avatar/female-1.webp', thumbSrc:'/assets/avatar/female-1-thumb.webp' },
  { id:'avatar_female_young_glasses', gender:'female', label:'头像 2', src:'/assets/avatar/female-2.webp', thumbSrc:'/assets/avatar/female-2-thumb.webp' },
  { id:'avatar_female_adult_plain', gender:'female', label:'头像 3', src:'/assets/avatar/female-3.webp', thumbSrc:'/assets/avatar/female-3-thumb.webp' },
  { id:'avatar_female_adult_glasses', gender:'female', label:'头像 4', src:'/assets/avatar/female-4.webp', thumbSrc:'/assets/avatar/female-4-thumb.webp' }
]

export function avatarPresetById(value?: string) {
  return AVATAR_PRESETS.find((item) => item.id === value)
}
