export const ELIZA_CHARACTER_EDITABLE_TOP_LEVEL_FIELDS = [
  'name',
  'system',
  'bio',
  'lore',
  'messageExamples',
  'postExamples',
  'topics',
  'adjectives',
  'style'
] as const

export const ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS = ['all', 'chat', 'post'] as const

export type ElizaCharacterEditableTopLevelField =
  (typeof ELIZA_CHARACTER_EDITABLE_TOP_LEVEL_FIELDS)[number]

export type ElizaCharacterEditableStyleField =
  (typeof ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS)[number]

export function isElizaCharacterEditableTopLevelField(
  value: string
): value is ElizaCharacterEditableTopLevelField {
  return ELIZA_CHARACTER_EDITABLE_TOP_LEVEL_FIELDS.some((field) => field === value)
}

export function isElizaCharacterEditableStyleField(
  value: string
): value is ElizaCharacterEditableStyleField {
  return ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS.some((field) => field === value)
}

export interface ElizaCharacterSettings {
  enabled: boolean
  characterJson: string
  defaultCharacterJson: string
  warnings: string[]
}

export interface UpdateElizaCharacterSettingsRequest {
  enabled: boolean
  characterJson: string
}
