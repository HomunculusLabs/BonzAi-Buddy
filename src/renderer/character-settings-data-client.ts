import type {
  ElizaCharacterSettings,
  UpdateElizaCharacterSettingsRequest
} from '../shared/contracts/character'

export interface CharacterSettingsDataClient {
  isAvailable(): boolean
  getSettings(): Promise<ElizaCharacterSettings>
  updateSettings(
    request: UpdateElizaCharacterSettingsRequest
  ): Promise<ElizaCharacterSettings>
}

export function createCharacterSettingsDataClient(): CharacterSettingsDataClient {
  const requireBridge = (): NonNullable<typeof window.bonzi> => {
    if (!window.bonzi) {
      throw new Error('Bonzi bridge unavailable')
    }

    return window.bonzi
  }

  return {
    isAvailable: () => Boolean(window.bonzi),
    getSettings: async () => {
      const bridge = requireBridge()
      return bridge.settings.getElizaCharacterSettings()
    },
    updateSettings: async (request) => {
      const bridge = requireBridge()
      return bridge.settings.updateElizaCharacterSettings(request)
    }
  }
}
