import type { ElizaCharacterSettings } from '../shared/contracts/character'
import {
  createCharacterJsonFromDraft,
  createDraftFromSettings,
  createEmptyDraft,
  type CharacterEditorDraft,
  type DraftSnapshot,
  type DraftSource
} from './character-settings-draft'
import { renderCharacterSettings } from './character-settings-view'

export interface CharacterSettingsState {
  getSettings(): ElizaCharacterSettings | null
  syncDraftFromSettings(settings: ElizaCharacterSettings): void
  isSaving(): boolean
  setSaving(saving: boolean): void
  isHydrated(): boolean
  getDraftEnabled(): boolean
  setDraftEnabled(enabled: boolean): void
  getDraft(): CharacterEditorDraft
  setDraft(draft: CharacterEditorDraft): void
  getDraftJson(): string
  setDraftJson(value: string): void
  getDraftSource(): DraftSource
  setDraftSource(source: DraftSource): void
  createDraftSnapshot(): DraftSnapshot
  restoreDraftSnapshot(snapshot: DraftSnapshot): void
  render(): void
}

export function createCharacterSettingsState(options: {
  characterSettingsEl: HTMLElement
}): CharacterSettingsState {
  const { characterSettingsEl } = options

  let settings: ElizaCharacterSettings | null = null
  let draftEnabled = false
  let draft = createEmptyDraft()
  let draftJson = ''
  let draftSource: DraftSource = 'form'
  let isSaving = false
  let isHydrated = false

  return {
    getSettings: () => settings,
    syncDraftFromSettings: (nextSettings) => {
      settings = nextSettings
      draftEnabled = nextSettings.enabled
      draft = createDraftFromSettings(nextSettings)
      const savedCharacterJson = nextSettings.characterJson ?? '{}'
      draftJson = savedCharacterJson.trim() === '{}'
        ? createCharacterJsonFromDraft(draft)
        : savedCharacterJson
      draftSource = 'form'
      isHydrated = true
    },
    isSaving: () => isSaving,
    setSaving: (saving) => {
      isSaving = saving
    },
    isHydrated: () => isHydrated,
    getDraftEnabled: () => draftEnabled,
    setDraftEnabled: (enabled) => {
      draftEnabled = enabled
    },
    getDraft: () => draft,
    setDraft: (nextDraft) => {
      draft = nextDraft
    },
    getDraftJson: () => draftJson,
    setDraftJson: (value) => {
      draftJson = value
    },
    getDraftSource: () => draftSource,
    setDraftSource: (source) => {
      draftSource = source
    },
    createDraftSnapshot: () => ({
      enabled: draftEnabled,
      draft: { ...draft },
      draftJson,
      draftSource
    }),
    restoreDraftSnapshot: (snapshot) => {
      draftEnabled = snapshot.enabled
      draft = { ...snapshot.draft }
      draftJson = snapshot.draftJson
      draftSource = snapshot.draftSource
    },
    render: () => {
      renderCharacterSettings(characterSettingsEl, {
        settings,
        draftEnabled,
        draft,
        draftJson,
        draftSource,
        isSaving,
        isHydrated
      })
    }
  }
}
