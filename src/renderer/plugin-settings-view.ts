import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  type ElizaAvailablePluginEntry,
  type ElizaInstalledPluginEntry,
  type ElizaOptionalPluginId,
  type ElizaPluginSettings
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

interface RenderPluginSettingsOptions {
  isSaving: boolean
  pendingInstallPluginIds: ReadonlySet<string>
}

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

function formatStatusLabel(value: string): string {
  return value
    .split(' ')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function renderMetadata(items: string[]): string {
  if (items.length === 0) {
    return ''
  }

  return `
    <div class="plugin-card__meta">
      ${items.map((item) => `<span>${item}</span>`).join('')}
    </div>
  `
}

function renderListMetadata(label: string, values: readonly string[]): string {
  if (values.length === 0) {
    return ''
  }

  return `<p class="plugin-card__description"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(values.join(', '))}</p>`
}

function renderIssues(
  label: string,
  values: readonly string[],
  tone: 'warning' | 'error'
): string {
  if (values.length === 0) {
    return ''
  }

  return `
    <div class="plugin-card__issues plugin-card__issues--${tone}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(values.join(' | '))}</span>
    </div>
  `
}

function renderInstalledPluginCard(
  plugin: ElizaInstalledPluginEntry,
  options: RenderPluginSettingsOptions
): string {
  const checked = plugin.enabled ? 'checked' : ''
  const disabled = options.isSaving ? 'disabled' : ''
  const pluginId = escapeHtml(plugin.id)
  const statusLabel = formatStatusLabel(normalizeStatus(plugin))
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
      <label class="plugin-card__toggle">
        <span>Enabled</span>
        <input
          class="settings-toggle-card__toggle"
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
          class="ghost-button plugin-card__button plugin-card__button--danger"
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
          class="ghost-button plugin-card__button plugin-card__button--danger"
          type="button"
          data-plugin-uninstall="${pluginId}"
          ${disabled}
        >Uninstall</button>
      `
      : ''

  const actionsMarkup =
    toggleMarkup || removeMarkup || uninstallMarkup
      ? `<div class="plugin-card__actions">${toggleMarkup}${removeMarkup}${uninstallMarkup}</div>`
      : ''

  const policyAttribute = plugin.executionPolicy
    ? ` data-plugin-policy="${escapeHtml(plugin.executionPolicy)}"`
    : ''

  return `
    <article class="settings-card plugin-card plugin-row" data-plugin-id="${pluginId}" data-plugin-installed="true"${policyAttribute}>
      <div class="plugin-card__main">
        <div class="plugin-card__title-row">
          <h4>${escapeHtml(plugin.name)}</h4>
          <span class="settings-badge">${escapeHtml(statusLabel)}</span>
        </div>
        <p class="plugin-card__description">${escapeHtml(plugin.description)}</p>
        ${renderMetadata(metadata)}
        ${renderListMetadata('Capabilities', plugin.capabilities ?? [])}
        ${renderIssues('Warnings', plugin.warnings ?? [], 'warning')}
        ${renderIssues('Errors', plugin.errors ?? [], 'error')}
      </div>
      ${actionsMarkup}
    </article>
  `
}

function renderAvailablePluginCard(
  plugin: ElizaAvailablePluginEntry,
  options: RenderPluginSettingsOptions
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

  const isPendingInstall = options.pendingInstallPluginIds.has(plugin.id)
  const rawStatusLabel = isPendingInstall ? 'preview ready' : normalizeStatus(plugin)
  const statusLabel = formatStatusLabel(rawStatusLabel)
  const isLegacyBuiltIn = isElizaOptionalPluginId(plugin.id)
  const addOrInstallLabel = isPendingInstall
    ? 'Confirm install'
    : isLegacyBuiltIn
      ? 'Add'
      : 'Install'
  const addOrInstallAttr = isLegacyBuiltIn
    ? `data-plugin-add="${pluginId}"`
    : `data-plugin-install="${pluginId}"`

  const policyAttribute = plugin.executionPolicy
    ? ` data-plugin-policy="${escapeHtml(plugin.executionPolicy)}"`
    : ''
  const pendingClass = isPendingInstall ? ' plugin-card--pending' : ''

  return `
    <article class="settings-card plugin-card plugin-row${pendingClass}" data-plugin-id="${pluginId}" data-plugin-available="true"${policyAttribute}>
      <div class="plugin-card__main">
        <div class="plugin-card__title-row">
          <h4>${escapeHtml(plugin.name)}</h4>
          <span class="settings-badge">${escapeHtml(statusLabel)}</span>
        </div>
        <p class="plugin-card__description">${escapeHtml(plugin.description)}</p>
        ${renderMetadata(metadata)}
        ${renderIssues('Warnings', plugin.warnings ?? [], 'warning')}
        ${renderIssues('Errors', plugin.errors ?? [], 'error')}
      </div>
      <div class="plugin-card__actions">
        <button
          class="ghost-button plugin-card__button${isPendingInstall ? ' plugin-card__button--confirm' : ''}"
          type="button"
          ${addOrInstallAttr}
          ${options.isSaving ? 'disabled' : ''}
        >${addOrInstallLabel}</button>
      </div>
    </article>
  `
}

function renderPluginGroup(
  label: string,
  copy: string,
  count: number,
  content: string
): string {
  return `
    <section class="plugin-settings__group" aria-label="${escapeHtml(label)}">
      <header class="plugin-settings__group-header">
        <div>
          <h3 class="settings-panel__section-title">${escapeHtml(label)}</h3>
          <p class="settings-panel__section-copy">${escapeHtml(copy)}</p>
        </div>
        <span class="settings-count-badge" aria-label="${count} plugins">${count}</span>
      </header>
      <div class="plugin-settings__grid">
        ${content}
      </div>
    </section>
  `
}

export function renderPluginSettings(
  container: HTMLElement,
  settings: ElizaPluginSettings | null,
  options: RenderPluginSettingsOptions
): void {
  if (!settings) {
    container.innerHTML =
      '<p class="settings-panel__muted settings-panel__empty">Loading elizaOS plugins…</p>'
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
          .map((plugin) => renderInstalledPluginCard(plugin, options))
          .join('')

  const installedMarkup =
    installedPlugins.length === 0
      ? '<p class="settings-panel__empty">No optional or external plugins are currently installed.</p>'
      : installedPlugins
          .map((plugin) => renderInstalledPluginCard(plugin, options))
          .join('')

  const availableMarkup =
    settings.availablePlugins.length === 0
      ? '<p class="settings-panel__empty">No discoverable plugins are available right now.</p>'
      : settings.availablePlugins
          .map((plugin) => renderAvailablePluginCard(plugin, options))
          .join('')

  container.innerHTML = `
    ${renderPluginGroup(
      'Runtime required',
      'These plugins are required by Bonzi runtime and cannot be toggled or removed here.',
      requiredPlugins.length,
      requiredMarkup
    )}
    ${renderPluginGroup(
      'Installed plugins',
      'Manage optional Bonzi built-ins and installed external plugins.',
      installedPlugins.length,
      installedMarkup
    )}
    ${renderPluginGroup(
      'Discover plugins',
      'Registry plugins require confirmation before install and are added disabled by default.',
      settings.availablePlugins.length,
      availableMarkup
    )}
  `
}

export function isElizaOptionalPluginId(
  value: string
): value is ElizaOptionalPluginId {
  return (ELIZA_OPTIONAL_PLUGIN_IDS as readonly string[]).includes(value)
}
