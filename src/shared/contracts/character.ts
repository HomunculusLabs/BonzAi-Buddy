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
