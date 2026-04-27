import { type ElizaCharacterSettings } from '../shared/contracts'
import { escapeHtml } from './html-utils'

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

interface CharacterEditorDraft {
  name: string
  system: string
  bioText: string
  loreText: string
  messageExamplesJson: string
  postExamplesText: string
  topicsText: string
  adjectivesText: string
  styleAllText: string
  styleChatText: string
  stylePostText: string
}

type DraftSource = 'form' | 'json'

interface DraftSnapshot {
  enabled: boolean
  draft: CharacterEditorDraft
  draftJson: string
  draftSource: DraftSource
}

export function createCharacterSettingsController(
  options: CharacterSettingsControllerOptions
): CharacterSettingsController {
  const { characterSettingsEl } = options

  let settings: ElizaCharacterSettings | null = null
  let draftEnabled = false
  let draft = createEmptyDraft()
  let draftJson = ''
  let draftSource: DraftSource = 'form'
  let isSaving = false
  let isHydrated = false

  const setSaving = (saving: boolean): void => {
    isSaving = saving
    options.onSavingChange(saving)
  }

  const syncDraftFromSettings = (nextSettings: ElizaCharacterSettings): void => {
    settings = nextSettings
    draftEnabled = nextSettings.enabled
    draft = createDraftFromSettings(nextSettings)
    const savedCharacterJson = nextSettings.characterJson ?? '{}'
    draftJson = savedCharacterJson.trim() === '{}'
      ? createCharacterJsonFromDraft(draft)
      : savedCharacterJson
    draftSource = 'form'
    isHydrated = true
  }

  const createDraftSnapshot = (): DraftSnapshot => ({
    enabled: draftEnabled,
    draft: { ...draft },
    draftJson,
    draftSource
  })

  const restoreDraftSnapshot = (snapshot: DraftSnapshot): void => {
    draftEnabled = snapshot.enabled
    draft = { ...snapshot.draft }
    draftJson = snapshot.draftJson
    draftSource = snapshot.draftSource
  }

  const readDraftFromForm = (): void => {
    draft = {
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
    }
  }

  const readDraftFromDom = (): {
    enabled: boolean
    characterJson: string
  } => {
    const enabledInput = characterSettingsEl.querySelector<HTMLInputElement>(
      '[data-character-enabled]'
    )
    const jsonInput = characterSettingsEl.querySelector<HTMLTextAreaElement>(
      '[data-character-json]'
    )

    if (enabledInput) {
      draftEnabled = enabledInput.checked
    }

    if (draftSource === 'json') {
      draftJson = jsonInput?.value ?? draftJson
    } else {
      readDraftFromForm()
      draftJson = createCharacterJsonFromDraft(draft)
    }

    return {
      enabled: draftEnabled,
      characterJson: draftJson
    }
  }

  const readInputValue = (selector: string): string => {
    const input = characterSettingsEl.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)
    return input?.value ?? ''
  }

  const syncAdvancedJsonTextarea = (): void => {
    const jsonInput = characterSettingsEl.querySelector<HTMLTextAreaElement>(
      '[data-character-json]'
    )

    if (!jsonInput) {
      return
    }

    try {
      draftJson = createCharacterJsonFromDraft(draft)
      jsonInput.value = draftJson
    } catch {
      // Leave the last valid advanced JSON visible while a nested structured
      // JSON field such as messageExamples is temporarily invalid.
    }
  }

  const syncFormControlsFromRawJson = (): void => {
    if (!settings) {
      return
    }

    try {
      draft = createDraftFromCharacterJson(settings.defaultCharacterJson, draftJson)
    } catch {
      return
    }

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

  const writeInputValue = (selector: string, value: string): void => {
    const input = characterSettingsEl.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(selector)

    if (input) {
      input.value = value
    }
  }

  const renderWarnings = (warnings: readonly string[]): string => {
    if (warnings.length === 0) {
      return ''
    }

    return `
      <div class="character-settings__warnings" data-character-warnings>
        <strong>Warnings</strong>
        <ul>
          ${warnings
            .map((warning) => `<li>${escapeHtml(warning)}</li>`)
            .join('')}
        </ul>
      </div>
    `
  }

  const render = (): void => {
    const statusLabel = draftEnabled ? 'Enabled' : 'Default'
    const disabled = isSaving || !isHydrated ? 'disabled' : ''
    const rawJson = draftJson || settings?.defaultCharacterJson || ''

    if (!isHydrated) {
      characterSettingsEl.innerHTML = `
        <div class="character-settings__intro">
          <div class="settings-panel__section-header">
            <h3 class="settings-panel__section-title">Eliza character editor</h3>
            <p class="settings-panel__section-copy">
              Loading Bonzi's editable elizaOS character fields…
            </p>
          </div>
        </div>
        <p class="settings-panel__empty">Character settings are loading. Controls will appear once Bonzi returns the current character template.</p>
      `
      return
    }

    characterSettingsEl.innerHTML = `
      <div class="character-settings__intro">
        <div class="settings-panel__section-header">
          <h3 class="settings-panel__section-title">Eliza character editor</h3>
          <p class="settings-panel__section-copy">
            Customize Bonzi's editable elizaOS character fields. Bonzi still owns runtime plugins, actions, providers, and safety rules.
          </p>
        </div>
      </div>
      <div class="character-settings__topline">
        <label class="settings-toggle-card character-settings__toggle-card">
          <span class="settings-toggle-card__copy">
            <span class="settings-toggle-card__title">
              Custom character
              <span class="settings-badge">${escapeHtml(statusLabel)}</span>
            </span>
            <span class="settings-toggle-card__description">
              Enable to apply these character edits after saving and reloading the runtime.
            </span>
          </span>
          <span class="settings-toggle-card__actions">
            <span>${draftEnabled ? 'On' : 'Off'}</span>
            <input
              class="settings-toggle-card__toggle"
              type="checkbox"
              data-character-enabled
              ${draftEnabled ? 'checked' : ''}
              ${disabled}
            />
          </span>
        </label>
        <div class="character-settings__toolbar" aria-label="Character editor actions">
          <button
            class="action-button character-settings__save"
            type="button"
            data-character-save
            ${disabled}
          >${isSaving ? 'Saving…' : 'Save Character'}</button>
          <button
            class="ghost-button character-settings__reset"
            type="button"
            data-character-reset
            ${disabled}
          >Reset</button>
        </div>
      </div>

      <div class="character-settings__form-grid">
      <div class="character-settings__section settings-card">
        <h4 class="character-settings__section-title">Identity</h4>
        <label class="character-settings__field">
          <span class="character-settings__editor-label">Name</span>
          <input
            class="character-settings__input"
            type="text"
            data-character-name
            value="${escapeHtml(draft.name)}"
            ${disabled}
          />
        </label>
        <label class="character-settings__field">
          <span class="character-settings__editor-label">System prompt</span>
          <textarea
            class="character-settings__editor character-settings__editor--system"
            data-character-system
            spellcheck="false"
            ${disabled}
          >${escapeHtml(draft.system)}</textarea>
        </label>
        <label class="character-settings__field">
          <span class="character-settings__editor-label">Bio</span>
          <textarea
            class="character-settings__editor character-settings__editor--compact"
            data-character-bio
            spellcheck="true"
            ${disabled}
          >${escapeHtml(draft.bioText)}</textarea>
          <span class="character-settings__hint">Use one line for a single bio, or multiple lines for a bio list.</span>
        </label>
      </div>

      <div class="character-settings__section settings-card">
        <h4 class="character-settings__section-title">Character memory</h4>
        ${renderListField('Lore', 'data-character-lore', draft.loreText, 'One lore item per line.', disabled)}
        ${renderJsonField('Message examples', 'data-character-message-examples', draft.messageExamplesJson, 'JSON array of example conversations using { "name", "content": { "text" } } messages.', disabled)}
        ${renderListField('Post examples', 'data-character-post-examples', draft.postExamplesText, 'One example post per line.', disabled)}
      </div>

      <div class="character-settings__section settings-card">
        <h4 class="character-settings__section-title">Personality</h4>
        ${renderListField('Topics', 'data-character-topics', draft.topicsText, 'One topic per line.', disabled)}
        ${renderListField('Adjectives', 'data-character-adjectives', draft.adjectivesText, 'One adjective per line.', disabled)}
      </div>

      <div class="character-settings__section settings-card">
        <h4 class="character-settings__section-title">Style</h4>
        ${renderListField('Style: all', 'data-character-style-all', draft.styleAllText, 'General style guidance, one item per line.', disabled)}
        ${renderListField('Style: chat', 'data-character-style-chat', draft.styleChatText, 'Chat-specific style guidance, one item per line.', disabled)}
        ${renderListField('Style: post', 'data-character-style-post', draft.stylePostText, 'Post-specific style guidance, one item per line.', disabled)}
      </div>
      </div>

      <details class="character-settings__advanced settings-card" ${draftSource === 'json' ? 'open' : ''}>
        <summary>Advanced raw editable character JSON</summary>
        <p class="settings-panel__section-copy">
          This mirrors the structured editor. Unsupported runtime fields such as plugins, actions, providers, settings, clients, and secrets are rejected by Bonzi.
        </p>
        <textarea
          id="eliza-character-json"
          class="character-settings__editor character-settings__editor--advanced"
          data-character-json
          spellcheck="false"
          ${disabled}
        >${escapeHtml(rawJson)}</textarea>
      </details>
      ${renderWarnings(settings?.warnings ?? [])}
    `
  }

  const hydrate = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      syncDraftFromSettings(await window.bonzi.settings.getElizaCharacterSettings())
      render()

      if ((settings?.warnings ?? []).length > 0) {
        options.setStatusMessage(settings!.warnings.join(' '))
      }
    } catch (error) {
      options.setStatusMessage(
        `Failed to load Eliza character settings: ${String(error)}`
      )
    }
  }

  const submit = async (
    request: {
      enabled: boolean
      characterJson: string
    },
    displayCharacterJson = request.characterJson,
    onFailure?: () => void
  ): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    if (!settings) {
      options.setStatusMessage('Character settings are still loading.')
      return
    }

    const previousSettings = settings
    draftEnabled = request.enabled
    draftJson = displayCharacterJson
    setSaving(true)
    render()
    options.setStatusMessage('Saving Eliza character settings…')

    try {
      const nextSettings =
        await window.bonzi.settings.updateElizaCharacterSettings(request)
      const changed =
        !previousSettings ||
        previousSettings.enabled !== nextSettings.enabled ||
        previousSettings.characterJson !== nextSettings.characterJson

      syncDraftFromSettings(nextSettings)

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
      render()
    }
  }

  const handleInput = (event: Event): void => {
    const target = event.target

    if (
      target instanceof HTMLInputElement &&
      target.matches('[data-character-enabled]')
    ) {
      draftEnabled = target.checked
      render()
      return
    }

    if (
      target instanceof HTMLTextAreaElement &&
      target.matches('[data-character-json]')
    ) {
      draftSource = 'json'
      draftJson = target.value
      syncFormControlsFromRawJson()
      return
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      if (target.closest('[data-character-settings]')) {
        draftSource = 'form'
        readDraftFromForm()
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
        const request = readDraftFromDom()
        void submit(request)
      } catch (error) {
        options.setStatusMessage(
          `Failed to save Eliza character settings: ${String(error)}`
        )
      }
      return
    }

    if (resetButton) {
      if (!settings) {
        options.setStatusMessage('Character settings are still loading.')
        return
      }

      const defaultJson = settings.defaultCharacterJson
      const snapshot = createDraftSnapshot()
      draftSource = 'form'
      if (settings) {
        draft = createDraftFromCharacterJson(settings.defaultCharacterJson, '{}')
      }
      void submit({ enabled: false, characterJson: '{}' }, defaultJson, () =>
        restoreDraftSnapshot(snapshot)
      )
    }
  }

  characterSettingsEl.addEventListener('input', handleInput)
  characterSettingsEl.addEventListener('change', handleInput)
  characterSettingsEl.addEventListener('click', handleClick)

  render()

  return {
    hydrate,
    dispose: () => {
      characterSettingsEl.removeEventListener('input', handleInput)
      characterSettingsEl.removeEventListener('change', handleInput)
      characterSettingsEl.removeEventListener('click', handleClick)
    }
  }
}

function renderListField(
  label: string,
  dataAttribute: string,
  value: string,
  hint: string,
  disabled: string
): string {
  return `
    <label class="character-settings__field">
      <span class="character-settings__editor-label">${escapeHtml(label)}</span>
      <textarea
        class="character-settings__editor character-settings__editor--compact"
        ${dataAttribute}
        spellcheck="true"
        ${disabled}
      >${escapeHtml(value)}</textarea>
      <span class="character-settings__hint">${escapeHtml(hint)}</span>
    </label>
  `
}

function renderJsonField(
  label: string,
  dataAttribute: string,
  value: string,
  hint: string,
  disabled: string
): string {
  return `
    <label class="character-settings__field">
      <span class="character-settings__editor-label">${escapeHtml(label)}</span>
      <textarea
        class="character-settings__editor character-settings__editor--json"
        ${dataAttribute}
        spellcheck="false"
        ${disabled}
      >${escapeHtml(value)}</textarea>
      <span class="character-settings__hint">${escapeHtml(hint)}</span>
    </label>
  `
}

function createEmptyDraft(): CharacterEditorDraft {
  return {
    name: '',
    system: '',
    bioText: '',
    loreText: '',
    messageExamplesJson: '[]',
    postExamplesText: '',
    topicsText: '',
    adjectivesText: '',
    styleAllText: '',
    styleChatText: '',
    stylePostText: ''
  }
}

function createDraftFromSettings(
  settings: ElizaCharacterSettings
): CharacterEditorDraft {
  return createDraftFromCharacterJson(
    settings.defaultCharacterJson,
    settings.characterJson
  )
}

function createDraftFromCharacterJson(
  defaultCharacterJson: string,
  characterJson: string
): CharacterEditorDraft {
  const defaults = parseCharacterRecord(defaultCharacterJson)
  const override = characterJson.trim() === '{}'
    ? {}
    : parseCharacterRecord(characterJson)
  const defaultStyle = isRecord(defaults.style) ? defaults.style : {}
  const overrideStyle = isRecord(override.style) ? override.style : {}
  const merged = {
    ...defaults,
    ...override,
    style: {
      ...defaultStyle,
      ...overrideStyle
    }
  }

  return createDraftFromRecord(merged)
}

function createDraftFromRecord(record: Record<string, unknown>): CharacterEditorDraft {
  const style = isRecord(record.style) ? record.style : {}

  return {
    name: readString(record.name),
    system: readString(record.system),
    bioText: readStringOrStringArray(record.bio),
    loreText: readStringArray(record.lore).join('\n'),
    messageExamplesJson: JSON.stringify(
      Array.isArray(record.messageExamples) ? record.messageExamples : [],
      null,
      2
    ),
    postExamplesText: readStringArray(record.postExamples).join('\n'),
    topicsText: readStringArray(record.topics).join('\n'),
    adjectivesText: readStringArray(record.adjectives).join('\n'),
    styleAllText: readStringArray(style.all).join('\n'),
    styleChatText: readStringArray(style.chat).join('\n'),
    stylePostText: readStringArray(style.post).join('\n')
  }
}

function createCharacterJsonFromDraft(draft: CharacterEditorDraft): string {
  const bioEntries = splitLines(draft.bioText)
  const messageExamples = parseJsonArray(
    draft.messageExamplesJson,
    'Eliza character message examples'
  )

  return JSON.stringify(
    {
      name: draft.name,
      system: draft.system,
      bio: bioEntries.length <= 1 ? draft.bioText.trim() : bioEntries,
      lore: splitLines(draft.loreText),
      messageExamples,
      postExamples: splitLines(draft.postExamplesText),
      topics: splitLines(draft.topicsText),
      adjectives: splitLines(draft.adjectivesText),
      style: {
        all: splitLines(draft.styleAllText),
        chat: splitLines(draft.styleChatText),
        post: splitLines(draft.stylePostText)
      }
    },
    null,
    2
  )
}

function parseJsonArray(value: string, label: string): unknown[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`)
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} JSON is invalid: ${message}`)
  }
}

function parseCharacterRecord(characterJson: string): Record<string, unknown> {
  const trimmed = characterJson.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (isRecord(parsed) && !Array.isArray(parsed)) {
    return parsed
  }

  throw new Error('Eliza character JSON must be an object.')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function readStringOrStringArray(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return readStringArray(value).join('\n')
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
