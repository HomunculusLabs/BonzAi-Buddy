import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  type ElizaOptionalPluginId,
  type ElizaPluginSettings
} from '../shared/contracts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderPluginSettings(
  container: HTMLElement,
  settings: ElizaPluginSettings | null,
  options: { isSaving: boolean }
): void {
  if (!settings) {
    container.innerHTML =
      '<p class="settings-panel__muted">Loading elizaOS plugins…</p>'
    return
  }

  const installedMarkup = settings.installedPlugins
    .map((plugin) => {
      const checked = plugin.enabled ? 'checked' : ''
      const disabled = options.isSaving ? 'disabled' : ''
      const status = plugin.required
        ? 'Required'
        : plugin.enabled
          ? 'Enabled'
          : 'Disabled'
      const packageName = plugin.packageName
        ? `<code>${escapeHtml(plugin.packageName)}</code>`
        : ''
      const toggleMarkup = plugin.configurable
        ? `
          <label class="plugin-row__action-group">
            <span>Enabled</span>
            <input
              class="plugin-row__toggle"
              type="checkbox"
              data-plugin-toggle="${escapeHtml(plugin.id)}"
              ${checked}
              ${disabled}
            />
          </label>
        `
        : ''
      const removeMarkup = plugin.removable
        ? `
          <button
            class="ghost-button plugin-row__button plugin-row__button--remove"
            type="button"
            data-plugin-remove="${escapeHtml(plugin.id)}"
            ${disabled}
          >Remove</button>
        `
        : ''
      const actionsMarkup =
        toggleMarkup || removeMarkup
          ? `<div class="plugin-row__actions">${toggleMarkup}${removeMarkup}</div>`
          : ''

      return `
        <article class="plugin-row" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-installed="true">
          <div class="plugin-row__copy">
            <div class="plugin-row__title">
              ${escapeHtml(plugin.name)}
              <span class="plugin-row__status">${escapeHtml(status)}</span>
            </div>
            ${packageName}
            <p class="plugin-row__description">${escapeHtml(plugin.description)}</p>
          </div>
          ${actionsMarkup}
        </article>
      `
    })
    .join('')

  const availableMarkup =
    settings.availablePlugins.length === 0
      ? '<p class="settings-panel__empty">All curated Bonzi plugins are already added.</p>'
      : settings.availablePlugins
          .map((plugin) => {
            const packageName = plugin.packageName
              ? `<code>${escapeHtml(plugin.packageName)}</code>`
              : ''

            return `
              <article class="plugin-row" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-available="true">
                <div class="plugin-row__copy">
                  <div class="plugin-row__title">${escapeHtml(plugin.name)}</div>
                  ${packageName}
                  <p class="plugin-row__description">${escapeHtml(plugin.description)}</p>
                </div>
                <div class="plugin-row__actions">
                  <button
                    class="ghost-button plugin-row__button"
                    type="button"
                    data-plugin-add="${escapeHtml(plugin.id)}"
                    ${options.isSaving ? 'disabled' : ''}
                  >Add</button>
                </div>
              </article>
            `
          })
          .join('')

  container.innerHTML = `
    <section class="settings-panel__section" aria-label="Installed elizaOS plugins">
      <header class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Installed plugins</h3>
        <p class="settings-panel__section-copy">Required plugins stay managed by Bonzi. Optional plugins can be disabled or removed from this list.</p>
      </header>
      ${installedMarkup}
    </section>
    <section class="settings-panel__section" aria-label="Available bundled elizaOS plugins">
      <header class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Available plugins</h3>
        <p class="settings-panel__section-copy">These plugins are bundled with Bonzi; adding them does not download or install npm packages at runtime.</p>
      </header>
      ${availableMarkup}
    </section>
  `
}

export function isElizaOptionalPluginId(
  value: string
): value is ElizaOptionalPluginId {
  return (ELIZA_OPTIONAL_PLUGIN_IDS as readonly string[]).includes(value)
}
