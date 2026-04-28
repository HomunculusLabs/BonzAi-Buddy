import type { UpdateElizaCharacterSettingsRequest } from '../shared/contracts/character'
import { createCharacterSettingsDataClient } from './character-settings-data-client'
import {
  createCharacterJsonFromDraft,
  createDraftFromCharacterJson,
  type CharacterEditorDraft
} from './character-settings-draft'
import { createCharacterSettingsState } from './character-settings-state'

interface CharacterSettingsControllerOptions {
  characterSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  onSavingChange(saving: boolean): void
}

export interface CharacterSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

export function createCharacterSettingsController(
  options: CharacterSettingsControllerOptions
): CharacterSettingsController {
  const { characterSettingsEl } = options
  const state = createCharacterSettingsState({ characterSettingsEl })
  const client = createCharacterSettingsDataClient()

  const setSaving = (saving: boolean): void => {
    state.setSaving(saving)
    options.onSavingChange(saving)
  }

  const readInputValue = (selector: string): string => {
    const input = characterSettingsEl.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)
    return input?.value ?? ''
  }

  const writeInputValue = (selector: string, value: string): void => {
    const input = characterSettingsEl.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)

    if (input) {
      input.value = value
    }
  }

  const readDraftFromForm = (): CharacterEditorDraft => ({
    name: readInputValue('[data-character-name]'),
    system: readInputValue('[data-character-system]'),
    bioText: readInputValue('[data-character-bio]'),
    loreText: readInputValue('[data-character-lore]'),
    messageExamplesJson: readInputValue('[data-character-message-examples]'),
    postExamplesText: readInputValue('[data-character-post-examples]'),
    topicsText: readInputValue('[data-character-topics]'),
    adjectivesText: readInputValue('[data-character-adjectives]'),
    styleAllText: readInputValue('[data-character-style-all]'),
    styleChatText: readInputValue('[data-character-style-chat]'),
    stylePostText: readInputValue('[data-character-style-post]')
  })

  const readDraftFromDom = (): UpdateElizaCharacterSettingsRequest => {
    const enabledInput = characterSettingsEl.querySelector<HTMLInputElement>(
      '[data-character-enabled]'
    )
    const jsonInput = characterSettingsEl.querySelector<HTMLTextAreaElement>(
      '[data-character-json]'
    )

    if (enabledInput) {
      state.setDraftEnabled(enabledInput.checked)
    }

    if (state.getDraftSource() === 'json') {
      state.setDraftJson(jsonInput?.value ?? state.getDraftJson())
    } else {
      const nextDraft = readDraftFromForm()
      state.setDraft(nextDraft)
      state.setDraftJson(createCharacterJsonFromDraft(nextDraft))
    }

    return {
      enabled: state.getDraftEnabled(),
      characterJson: state.getDraftJson()
    }
  }

  const syncAdvancedJsonTextarea = (): void => {
    const jsonInput = characterSettingsEl.querySelector<HTMLTextAreaElement>(
      '[data-character-json]'
    )

    if (!jsonInput) {
      return
    }

    try {
      const nextJson = createCharacterJsonFromDraft(state.getDraft())
      state.setDraftJson(nextJson)
      jsonInput.value = nextJson
    } catch {
      // Leave the last valid advanced JSON visible while a nested structured
      // JSON field such as messageExamples is temporarily invalid.
    }
  }

  const syncFormControlsFromRawJson = (): void => {
    const settings = state.getSettings()

    if (!settings) {
      return
    }

    try {
      state.setDraft(
        createDraftFromCharacterJson(
          settings.defaultCharacterJson,
          state.getDraftJson()
        )
      )
    } catch {
      return
    }

    const draft = state.getDraft()
    writeInputValue('[data-character-name]', draft.name)
    writeInputValue('[data-character-system]', draft.system)
    writeInputValue('[data-character-bio]', draft.bioText)
    writeInputValue('[data-character-lore]', draft.loreText)
    writeInputValue('[data-character-message-examples]', draft.messageExamplesJson)
    writeInputValue('[data-character-post-examples]', draft.postExamplesText)
    writeInputValue('[data-character-topics]', draft.topicsText)
    writeInputValue('[data-character-adjectives]', draft.adjectivesText)
    writeInputValue('[data-character-style-all]', draft.styleAllText)
    writeInputValue('[data-character-style-chat]', draft.styleChatText)
    writeInputValue('[data-character-style-post]', draft.stylePostText)
  }

  const hydrate = async (): Promise<void> => {
    if (!client.isAvailable()) {
      return
    }

    try {
      state.syncDraftFromSettings(await client.getSettings())
      state.render()

      const warnings = state.getSettings()?.warnings ?? []
      if (warnings.length > 0) {
        options.setStatusMessage(warnings.join(' '))
      }
    } catch (error) {
      options.setStatusMessage(
        `Failed to load Eliza character settings: ${String(error)}`
      )
    }
  }

  const submit = async (
    request: UpdateElizaCharacterSettingsRequest,
    displayCharacterJson = request.characterJson,
    onFailure?: () => void
  ): Promise<void> => {
    if (!client.isAvailable() || state.isSaving()) {
      return
    }

    const previousSettings = state.getSettings()
    if (!previousSettings) {
      options.setStatusMessage('Character settings are still loading.')
      return
    }

    state.setDraftEnabled(request.enabled)
    state.setDraftJson(displayCharacterJson)
    setSaving(true)
    state.render()
    options.setStatusMessage('Saving Eliza character settings…')

    try {
      const nextSettings = await client.updateSettings(request)
      const changed =
        previousSettings.enabled !== nextSettings.enabled ||
        previousSettings.characterJson !== nextSettings.characterJson

      state.syncDraftFromSettings(nextSettings)

      if (changed) {
        options.setRuntimeReloadPending(true)
      }

      options.setStatusMessage(
        changed
          ? 'Saved Eliza character settings. Apply Runtime Changes to reload elizaOS.'
          : 'Eliza character settings are already up to date.'
      )
    } catch (error) {
      onFailure?.()
      options.setStatusMessage(
        `Failed to save Eliza character settings: ${String(error)}`
      )
    } finally {
      setSaving(false)
      state.render()
    }
  }

  const handleInput = (event: Event): void => {
    const target = event.target

    if (
      target instanceof HTMLInputElement &&
      target.matches('[data-character-enabled]')
    ) {
      state.setDraftEnabled(target.checked)
      state.render()
      return
    }

    if (
      target instanceof HTMLTextAreaElement &&
      target.matches('[data-character-json]')
    ) {
      state.setDraftSource('json')
      state.setDraftJson(target.value)
      syncFormControlsFromRawJson()
      return
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      if (target.closest('[data-character-settings]')) {
        state.setDraftSource('form')
        state.setDraft(readDraftFromForm())
        syncAdvancedJsonTextarea()
      }
    }
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const saveButton = target.closest<HTMLButtonElement>('[data-character-save]')
    const resetButton = target.closest<HTMLButtonElement>('[data-character-reset]')

    if (saveButton) {
      try {
        void submit(readDraftFromDom())
      } catch (error) {
        options.setStatusMessage(
          `Failed to save Eliza character settings: ${String(error)}`
        )
      }
      return
    }

    if (resetButton) {
      const settings = state.getSettings()
      if (!settings) {
        options.setStatusMessage('Character settings are still loading.')
        return
      }

      const defaultJson = settings.defaultCharacterJson
      const snapshot = state.createDraftSnapshot()
      state.setDraftSource('form')
      state.setDraft(createDraftFromCharacterJson(settings.defaultCharacterJson, '{}'))
      void submit(
        { enabled: false, characterJson: '{}' },
        defaultJson,
        () => state.restoreDraftSnapshot(snapshot)
      )
    }
  }

  characterSettingsEl.addEventListener('input', handleInput)
  characterSettingsEl.addEventListener('change', handleInput)
  characterSettingsEl.addEventListener('click', handleClick)

  state.render()

  return {
    hydrate,
    dispose: () => {
      characterSettingsEl.removeEventListener('input', handleInput)
      characterSettingsEl.removeEventListener('change', handleInput)
      characterSettingsEl.removeEventListener('click', handleClick)
    }
  }
}
