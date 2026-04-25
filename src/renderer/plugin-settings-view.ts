import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  type ElizaInstalledPluginEntry,
  type ElizaOptionalPluginId,
  type ElizaPluginSettings
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

function normalizeStatus(plugin: {
  required?: boolean
  enabled?: boolean
  lifecycleStatus?: string
}): string {
  if (plugin.lifecycleStatus) {
    return plugin.lifecycleStatus.replaceAll('_', ' ')
  }

  if (plugin.required) {
    return 'required'
  }

  if (plugin.enabled) {
    return 'enabled'
  }

  return 'available'
}

function renderInlineMetadata(items: string[]): string {
  if (items.length === 0) {
    return ''
  }

  return `<p class="plugin-row__description">${items.join(' · ')}</p>`
}

function renderListMetadata(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return ''
  }

  return `<p class="plugin-row__description"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(values.join(', '))}</p>`
}

function renderIssues(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return ''
  }

  return `<p class="plugin-row__description"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(values.join(' | '))}</p>`
}

function renderInstalledPluginRow(
  plugin: ElizaInstalledPluginEntry,
  options: { isSaving: boolean }
): string {
  const checked = plugin.enabled ? 'checked' : ''
  const disabled = options.isSaving ? 'disabled' : ''
  const pluginId = escapeHtml(plugin.id)
  const lifecycleStatus = normalizeStatus(plugin)
  const statusLabel = lifecycleStatus
    .split(' ')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
  const metadata: string[] = []

  if (plugin.packageName) {
    metadata.push(`<code>${escapeHtml(plugin.packageName)}</code>`)
  }

  if (plugin.version) {
    metadata.push(`Version ${escapeHtml(plugin.version)}`)
  }

  if (plugin.source) {
    metadata.push(`Source ${escapeHtml(plugin.source)}`)
  }

  if (plugin.executionPolicy) {
    metadata.push(`Policy ${escapeHtml(plugin.executionPolicy)}`)
  }

  const canToggle = !plugin.required && (plugin.configurable || plugin.removable)
  const isLegacyBuiltIn = isElizaOptionalPluginId(plugin.id)

  const toggleMarkup = canToggle
    ? `
      <label class="plugin-row__action-group">
        <span>Enabled</span>
        <input
          class="plugin-row__toggle"
          type="checkbox"
          data-plugin-toggle="${pluginId}"
          ${checked}
          ${disabled}
        />
      </label>
    `
    : ''

  const removeMarkup =
    plugin.removable && isLegacyBuiltIn
      ? `
        <button
          class="ghost-button plugin-row__button plugin-row__button--remove"
          type="button"
          data-plugin-remove="${pluginId}"
          ${disabled}
        >Remove</button>
      `
      : ''

  const uninstallMarkup =
    plugin.removable && !isLegacyBuiltIn
      ? `
        <button
          class="ghost-button plugin-row__button plugin-row__button--remove"
          type="button"
          data-plugin-uninstall="${pluginId}"
          ${disabled}
        >Uninstall</button>
      `
      : ''

  const actionsMarkup =
    toggleMarkup || removeMarkup || uninstallMarkup
      ? `<div class="plugin-row__actions">${toggleMarkup}${removeMarkup}${uninstallMarkup}</div>`
      : ''

  const policyAttribute = plugin.executionPolicy
    ? ` data-plugin-policy="${escapeHtml(plugin.executionPolicy)}"`
    : ''

  return `
    <article class="plugin-row" data-plugin-id="${pluginId}" data-plugin-installed="true"${policyAttribute}>
      <div class="plugin-row__copy">
        <div class="plugin-row__title">
          ${escapeHtml(plugin.name)}
          <span class="plugin-row__status">${escapeHtml(statusLabel)}</span>
        </div>
        ${renderInlineMetadata(metadata)}
        <p class="plugin-row__description">${escapeHtml(plugin.description)}</p>
        ${renderListMetadata('Capabilities', plugin.capabilities ?? [])}
        ${renderIssues('Warnings', plugin.warnings ?? [])}
        ${renderIssues('Errors', plugin.errors ?? [])}
      </div>
      ${actionsMarkup}
    </article>
  `
}

function renderAvailablePluginRow(
  plugin: {
    id: string
    name: string
    packageName?: string
    version?: string
    description: string
    source?: string
    lifecycleStatus?: string
    executionPolicy?: string
    warnings?: string[]
    errors?: string[]
  },
  options: { isSaving: boolean }
): string {
  const pluginId = escapeHtml(plugin.id)
  const metadata: string[] = []

  if (plugin.packageName) {
    metadata.push(`<code>${escapeHtml(plugin.packageName)}</code>`)
  }

  if (plugin.version) {
    metadata.push(`Version ${escapeHtml(plugin.version)}`)
  }

  if (plugin.source) {
    metadata.push(`Source ${escapeHtml(plugin.source)}`)
  }

  if (plugin.executionPolicy) {
    metadata.push(`Policy ${escapeHtml(plugin.executionPolicy)}`)
  }

  const statusLabel = normalizeStatus(plugin)
    .split(' ')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
  const isLegacyBuiltIn = isElizaOptionalPluginId(plugin.id)
  const addOrInstallLabel = isLegacyBuiltIn ? 'Add' : 'Install'
  const addOrInstallAttr = isLegacyBuiltIn
    ? `data-plugin-add="${pluginId}"`
    : `data-plugin-install="${pluginId}"`

  const policyAttribute = plugin.executionPolicy
    ? ` data-plugin-policy="${escapeHtml(plugin.executionPolicy)}"`
    : ''

  return `
    <article class="plugin-row" data-plugin-id="${pluginId}" data-plugin-available="true"${policyAttribute}>
      <div class="plugin-row__copy">
        <div class="plugin-row__title">
          ${escapeHtml(plugin.name)}
          <span class="plugin-row__status">${escapeHtml(statusLabel)}</span>
        </div>
        ${renderInlineMetadata(metadata)}
        <p class="plugin-row__description">${escapeHtml(plugin.description)}</p>
        ${renderIssues('Warnings', plugin.warnings ?? [])}
        ${renderIssues('Errors', plugin.errors ?? [])}
      </div>
      <div class="plugin-row__actions">
        <button
          class="ghost-button plugin-row__button"
          type="button"
          ${addOrInstallAttr}
          ${options.isSaving ? 'disabled' : ''}
        >${addOrInstallLabel}</button>
      </div>
    </article>
  `
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

  const requiredPlugins = settings.installedPlugins.filter((plugin) => plugin.required)
  const installedPlugins = settings.installedPlugins.filter(
    (plugin) => !plugin.required
  )

  const requiredMarkup =
    requiredPlugins.length === 0
      ? '<p class="settings-panel__empty">No runtime-required plugins were reported.</p>'
      : requiredPlugins
          .map((plugin) => renderInstalledPluginRow(plugin, options))
          .join('')

  const installedMarkup =
    installedPlugins.length === 0
      ? '<p class="settings-panel__empty">No optional or external plugins are currently installed.</p>'
      : installedPlugins
          .map((plugin) => renderInstalledPluginRow(plugin, options))
          .join('')

  const availableMarkup =
    settings.availablePlugins.length === 0
      ? '<p class="settings-panel__empty">No discoverable plugins are available right now.</p>'
      : settings.availablePlugins
          .map((plugin) => renderAvailablePluginRow(plugin, options))
          .join('')

  container.innerHTML = `
    <section class="settings-panel__section" aria-label="Runtime required plugins">
      <header class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Runtime required</h3>
        <p class="settings-panel__section-copy">These plugins are required by Bonzi runtime and cannot be toggled or removed here.</p>
      </header>
      ${requiredMarkup}
    </section>
    <section class="settings-panel__section" aria-label="Installed elizaOS plugins">
      <header class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Installed plugins</h3>
        <p class="settings-panel__section-copy">Manage optional Bonzi built-ins and installed external plugins.</p>
      </header>
      ${installedMarkup}
    </section>
    <section class="settings-panel__section" aria-label="Discoverable elizaOS plugins">
      <header class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Discover plugins</h3>
        <p class="settings-panel__section-copy">Registry plugins require confirmation before install and are added disabled by default.</p>
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
