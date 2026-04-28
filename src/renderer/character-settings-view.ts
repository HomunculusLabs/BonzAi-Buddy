import type { ElizaCharacterSettings } from '../shared/contracts/character'
import { escapeHtml } from './html-utils'
import type { CharacterEditorDraft, DraftSource } from './character-settings-draft'

export interface CharacterSettingsViewModel {
  settings: ElizaCharacterSettings | null
  draftEnabled: boolean
  draft: CharacterEditorDraft
  draftJson: string
  draftSource: DraftSource
  isSaving: boolean
  isHydrated: boolean
}

export function renderCharacterSettings(
  container: HTMLElement,
  viewModel: CharacterSettingsViewModel
): void {
  const {
    settings,
    draftEnabled,
    draft,
    draftJson,
    draftSource,
    isSaving,
    isHydrated
  } = viewModel
  const statusLabel = draftEnabled ? 'Enabled' : 'Default'
  const disabled = isSaving || !isHydrated ? 'disabled' : ''
  const rawJson = draftJson || settings?.defaultCharacterJson || ''

  if (!isHydrated) {
    container.innerHTML = `
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

  container.innerHTML = `
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
        >Reset Character</button>
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
        This mirrors the structured editor. Unsupported runtime fields such as plugins, actions, providers, settings, clients, secrets, and character knowledge sources are rejected by Bonzi. Import Markdown knowledge from the Knowledge tab instead.
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

function renderWarnings(warnings: readonly string[]): string {
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
