import type {
  HermesHealthCheckKind,
  HermesModelAuthSettings,
  HermesModelAuthSettingsResponse,
  HermesModelOption,
  HermesRuntimeSettings,
  HermesRuntimeSettingsResponse,
  ShellState
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

const CUSTOM_SELECT_VALUE = '__custom__'

interface HermesSettingsControllerOptions {
  hermesSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  onApplyShellState(state: ShellState): void
  onSavingChange(saving: boolean): void
}

export interface HermesSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

export function createHermesSettingsController(
  options: HermesSettingsControllerOptions
): HermesSettingsController {
  const { hermesSettingsEl } = options
  let response: HermesRuntimeSettingsResponse | null = null
  let modelAuthResponse: HermesModelAuthSettingsResponse | null = null
  let isHydrated = false
  let isSaving = false
  let healthResult = ''
  let modelAuthResult = ''

  const setSaving = (saving: boolean): void => {
    isSaving = saving
    options.onSavingChange(saving)
  }

  const hydrate = async (): Promise<void> => {
    if (!window.bonzi) {
      isHydrated = true
      render()
      return
    }

    try {
      const [runtime, modelAuth] = await Promise.all([
        window.bonzi.settings.getHermesRuntimeSettings(),
        window.bonzi.settings.getHermesModelAuthSettings()
      ])
      response = runtime
      modelAuthResponse = modelAuth
      isHydrated = true
      render()
    } catch (error) {
      isHydrated = true
      options.setStatusMessage(`Failed to load Hermes settings: ${String(error)}`)
      render()
    }
  }

  const render = (): void => {
    const bridgeAvailable = Boolean(window.bonzi)
    const settings = response?.settings
    const modelAuth = modelAuthResponse?.settings
    const disabled = !bridgeAvailable || !isHydrated || !settings || !modelAuth || isSaving
    const disabledAttr = disabled ? 'disabled' : ''
    const envOverrides = response?.envOverrides ?? []
    const warnings = response?.warnings ?? []

    hermesSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Hermes Model &amp; Auth/Profile</h3>
        <p class="settings-panel__section-copy">Manage Hermes-native model, provider, base URL, profile, and credential status for Bonzi’s secondary runtime. Eliza remains the primary assistant provider and orchestrator.</p>
      </div>

      ${modelAuth ? renderModelAuthCard(modelAuth, disabledAttr, modelAuthResult) : ''}

      <div class="settings-panel__section-header hermes-settings__runtime-header">
        <h3 class="settings-panel__section-title">Hermes runtime launch</h3>
        <p class="settings-panel__section-copy">Configure how Bonzi invokes Hermes as a secondary runtime. Model/provider fields here are per-launch compatibility overrides; prefer the Hermes-native section above for persistent model settings.</p>
      </div>

      <div class="settings-card hermes-settings__card" data-hermes-config>
        <div class="hermes-settings__grid">
          ${renderInput('CLI path', 'cli-path', settings?.cliPath ?? '', 'Hermes executable or absolute CLI path.', disabledAttr)}
          ${renderInput('Working directory', 'cwd', settings?.cwd ?? '', 'Directory used when Bonzi invokes Hermes.', disabledAttr)}
          ${renderInput('Launch model override', 'model', settings?.model ?? '', 'Optional per-launch --model override. Leave blank to use Hermes config/profile.', disabledAttr)}
          ${renderInput('Launch provider override', 'provider', settings?.providerOverride ?? '', 'Optional per-launch --provider override. Leave blank to use Hermes config/profile.', disabledAttr)}
          ${renderNumberInput('Timeout (ms)', 'timeout', settings?.timeoutMs ?? 300000, 'Maximum Hermes runtime per turn.', disabledAttr)}
        </div>
        <label class="character-settings__field hermes-settings__field hermes-settings__field--wide">
          <span class="character-settings__editor-label">Optional system prompt</span>
          <textarea class="character-settings__editor hermes-settings__prompt" data-hermes-system-prompt spellcheck="true" ${disabledAttr}>${escapeHtml(settings?.systemPrompt ?? '')}</textarea>
          <span class="character-settings__hint">Prepended to Hermes secondary-runtime prompts. Leave blank for Bonzi defaults.</span>
        </label>
      </div>

      <div class="settings-card hermes-settings__card" data-hermes-gateway>
        <label class="settings-toggle-card hermes-settings__gateway-toggle">
          <span class="settings-toggle-card__copy">
            <span class="settings-toggle-card__title">Hermes API server <span class="settings-badge">${settings?.gateway.enabled ? 'Enabled' : 'Disabled'}</span></span>
            <span class="settings-toggle-card__description">Use Hermes’ OpenAI-compatible API server for consultations. This is served by <code>hermes gateway</code> only when API_SERVER_ENABLED=true.</span>
          </span>
          <span class="settings-toggle-card__actions">
            <span>${settings?.gateway.enabled ? 'On' : 'Off'}</span>
            <input class="settings-toggle-card__toggle" type="checkbox" data-hermes-gateway-enabled ${settings?.gateway.enabled ? 'checked' : ''} ${disabledAttr} />
          </span>
        </label>
        <div class="hermes-settings__grid">
          ${renderInput('API base URL', 'gateway-url', settings?.gateway.baseUrl ?? '', 'Example: http://127.0.0.1:8642/v1', disabledAttr)}
          ${renderInput('API key', 'gateway-key', settings?.gateway.apiKey ?? '', 'Bearer key from API_SERVER_KEY.', disabledAttr, 'password')}
          ${renderInput('API host', 'gateway-host', settings?.gateway.host ?? '', 'Host used by the Hermes API server.', disabledAttr)}
          ${renderNumberInput('API port', 'gateway-port', settings?.gateway.port ?? 8642, 'Port used by the Hermes API server.', disabledAttr)}
        </div>
      </div>

      <div class="settings-card hermes-settings__card hermes-settings__actions">
        <button class="action-button" type="button" data-hermes-save ${disabledAttr}>${isSaving ? 'Saving…' : 'Save Runtime Launch Settings'}</button>
        <button class="ghost-button" type="button" data-hermes-health="status" ${disabledAttr}>Check status</button>
        <button class="ghost-button" type="button" data-hermes-health="cron" ${disabledAttr}>List cron</button>
        <button class="ghost-button" type="button" data-hermes-health="gateway" ${disabledAttr}>Check API server</button>
      </div>

      ${envOverrides.length > 0 ? `<p class="settings-panel__empty hermes-settings__note">Environment overrides are active: ${escapeHtml(envOverrides.join(', '))}. Saved values remain editable, but overridden fields use environment values until those variables are unset.</p>` : ''}
      ${warnings.length > 0 ? `<div class="character-settings__warnings"><strong>Hermes warnings</strong><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>` : ''}
      ${healthResult ? `<pre class="settings-panel__empty hermes-settings__health" data-hermes-health-result>${escapeHtml(healthResult)}</pre>` : ''}
      ${!isHydrated ? '<p class="settings-panel__empty">Hermes settings are loading…</p>' : ''}
    `
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    if (target.closest('[data-hermes-native-save]')) {
      void saveModelAuth()
      return
    }

    if (target.closest('[data-hermes-native-test]')) {
      void testModelAuth()
      return
    }

    if (target.closest('[data-hermes-save]')) {
      void saveRuntime()
      return
    }

    const healthButton = target.closest<HTMLButtonElement>('[data-hermes-health]')
    const kind = healthButton?.dataset.hermesHealth
    if (isHermesHealthKind(kind)) {
      void runHealthCheck(kind)
    }
  }


  const handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement)) {
      return
    }

    if (target.matches('[data-hermes-native-provider]')) {
      syncSelectCustomInput('provider')
      updateModelOptionsForSelectedProvider()
      return
    }

    if (target.matches('[data-hermes-native-model]')) {
      syncSelectCustomInput('model')
    }
  }

  const handleInput = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) {
      return
    }

    if (target.matches('[data-hermes-native-provider-custom]')) {
      updateModelOptionsForSelectedProvider()
    }
  }

  const syncSelectCustomInput = (field: 'provider' | 'model'): void => {
    const select = hermesSettingsEl.querySelector<HTMLSelectElement>(`[data-hermes-native-${field}]`)
    const input = hermesSettingsEl.querySelector<HTMLInputElement>(`[data-hermes-native-${field}-custom]`)
    if (!select || !input) {
      return
    }

    const isCustom = select.value === CUSTOM_SELECT_VALUE
    input.hidden = !isCustom
    input.disabled = select.disabled || !isCustom
    if (isCustom && !input.value.trim()) {
      input.focus()
    }
  }

  const updateModelOptionsForSelectedProvider = (): void => {
    const settings = modelAuthResponse?.settings
    const select = hermesSettingsEl.querySelector<HTMLSelectElement>('[data-hermes-native-model]')
    if (!settings || !select) {
      return
    }

    const selectedProvider = readSelectOrCustom('native-provider') || settings.provider
    const selectedModel = readSelectOrCustom('native-model') || settings.model
    select.innerHTML = renderModelSelectOptions(settings, selectedProvider, selectedModel)
    syncSelectCustomInput('model')
  }

  const saveModelAuth = async (): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    const settings = readModelAuthFromDom()
    setSaving(true)
    options.setStatusMessage('Saving Hermes model/auth settings…')
    render()

    try {
      modelAuthResponse = await window.bonzi.settings.updateHermesModelAuthSettings(settings)
      modelAuthResult = ''
      options.setRuntimeReloadPending(true)
      options.setStatusMessage('Saved Hermes model/auth settings to the active Hermes profile.')
      const shellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(shellState)
    } catch (error) {
      options.setStatusMessage(`Failed to save Hermes model/auth settings: ${String(error)}`)
      await hydrate()
    } finally {
      setSaving(false)
      render()
    }
  }

  const testModelAuth = async (): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    setSaving(true)
    options.setStatusMessage('Checking saved Hermes model/auth status…')
    render()

    try {
      const result = await window.bonzi.settings.checkHermesModelAuthStatus()
      modelAuthResponse = { settings: result.settings }
      modelAuthResult = `${result.ok ? 'OK' : 'Needs attention'}: ${result.message}`
      options.setStatusMessage(result.message)
    } catch (error) {
      modelAuthResult = `Failed: ${String(error)}`
      options.setStatusMessage(`Hermes model/auth check failed: ${String(error)}`)
    } finally {
      setSaving(false)
      render()
    }
  }

  const saveRuntime = async (): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    const settings = readRuntimeFromDom()
    setSaving(true)
    options.setStatusMessage('Saving Hermes runtime settings…')
    render()

    try {
      response = await window.bonzi.settings.updateHermesRuntimeSettings(settings)
      healthResult = ''
      options.setRuntimeReloadPending(true)
      options.setStatusMessage('Saved Hermes runtime settings. Apply Runtime Changes to reload Eliza and Hermes.')
      const shellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(shellState)
    } catch (error) {
      options.setStatusMessage(`Failed to save Hermes runtime settings: ${String(error)}`)
      await hydrate()
    } finally {
      setSaving(false)
      render()
    }
  }

  const runHealthCheck = async (kind: HermesHealthCheckKind): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    setSaving(true)
    options.setStatusMessage(`Running Hermes ${kind} check…`)
    render()

    try {
      const result = await window.bonzi.settings.checkHermesHealth({ kind })
      healthResult = [
        `${result.ok ? 'OK' : 'Failed'}: ${result.message}`,
        result.details ?? ''
      ].filter(Boolean).join('\n')
      options.setStatusMessage(result.message)
    } catch (error) {
      healthResult = `Failed: ${String(error)}`
      options.setStatusMessage(`Hermes ${kind} check failed: ${String(error)}`)
    } finally {
      setSaving(false)
      render()
    }
  }

  const readModelAuthFromDom = (): { provider?: string; model?: string; baseUrl?: string; activeProfile?: string } => ({
    provider: readSelectOrCustom('native-provider'),
    model: readSelectOrCustom('native-model'),
    baseUrl: readText('native-base-url'),
    activeProfile: hermesSettingsEl.querySelector<HTMLSelectElement>('[data-hermes-native-profile]')?.value ?? 'default'
  })

  const readRuntimeFromDom = (): HermesRuntimeSettings => {
    const current = response?.settings

    return {
      cliPath: readText('cli-path') || current?.cliPath || 'hermes',
      cwd: readText('cwd') || current?.cwd || '',
      ...(readText('model') ? { model: readText('model') } : {}),
      ...(readText('provider') ? { providerOverride: readText('provider') } : {}),
      timeoutMs: readNumber('timeout', current?.timeoutMs ?? 300000),
      ...(readTextarea('system-prompt') ? { systemPrompt: readTextarea('system-prompt') } : {}),
      gateway: {
        enabled: Boolean(hermesSettingsEl.querySelector<HTMLInputElement>('[data-hermes-gateway-enabled]')?.checked),
        baseUrl: readText('gateway-url') || current?.gateway.baseUrl || '',
        ...(readText('gateway-key') ? { apiKey: readText('gateway-key') } : {}),
        host: readText('gateway-host') || current?.gateway.host || '127.0.0.1',
        port: readNumber('gateway-port', current?.gateway.port ?? 8642)
      }
    }
  }

  const readSelectOrCustom = (field: 'native-provider' | 'native-model'): string => {
    const select = hermesSettingsEl.querySelector<HTMLSelectElement>(`[data-hermes-${field}]`)
    const value = select?.value.trim() ?? ''
    if (value === CUSTOM_SELECT_VALUE) {
      return hermesSettingsEl.querySelector<HTMLInputElement>(`[data-hermes-${field}-custom]`)?.value.trim() ?? ''
    }
    return value
  }

  const readText = (field: string): string =>
    hermesSettingsEl.querySelector<HTMLInputElement>(`[data-hermes-${field}]`)?.value.trim() ?? ''

  const readTextarea = (field: string): string =>
    hermesSettingsEl.querySelector<HTMLTextAreaElement>(`[data-hermes-${field}]`)?.value.trim() ?? ''

  const readNumber = (field: string, fallback: number): number => {
    const value = Number.parseInt(readText(field), 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  hermesSettingsEl.addEventListener('click', handleClick)
  hermesSettingsEl.addEventListener('change', handleChange)
  hermesSettingsEl.addEventListener('input', handleInput)
  render()

  return {
    hydrate,
    dispose: () => {
      hermesSettingsEl.removeEventListener('click', handleClick)
      hermesSettingsEl.removeEventListener('change', handleChange)
      hermesSettingsEl.removeEventListener('input', handleInput)
      setSaving(false)
    }
  }
}

function renderModelAuthCard(
  settings: HermesModelAuthSettings,
  disabledAttr: string,
  modelAuthResult: string
): string {
  const authBadge = settings.auth.configured ? 'Configured' : 'Missing'
  const credentials = settings.auth.configuredEnvKeys.length > 0
    ? settings.auth.configuredEnvKeys.map((credential) => `${credential.key}=${credential.maskedValue} (${credential.source})`).join(', ')
    : 'No API key value exposed to Bonzi.'
  const profileOptions = settings.profiles.map((profile) => `
    <option value="${escapeHtml(profile.name)}" ${profile.active ? 'selected' : ''}>${escapeHtml(profile.name)} — ${escapeHtml(profile.path)}</option>
  `).join('')

  return `
    <div class="settings-card hermes-settings__card" data-hermes-native-settings>
      <div class="hermes-settings__grid">
        <label class="character-settings__field hermes-settings__field">
          <span class="character-settings__editor-label">Active profile</span>
          <select class="character-settings__input" data-hermes-native-profile ${disabledAttr}>${profileOptions}</select>
          <span class="character-settings__hint">Source: ${escapeHtml(settings.activeProfile.source)}. Profiles are separate Hermes home directories.</span>
        </label>
        ${renderProviderSelect(settings, disabledAttr)}
        ${renderModelSelect(settings, disabledAttr)}
        ${renderInput('Base URL', 'native-base-url', settings.baseUrl ?? '', `Optional provider/custom endpoint URL. Source: ${settings.sources.baseUrl}.`, disabledAttr)}
      </div>
      <div class="hermes-settings__status-grid">
        ${renderStatusItem('Profile path', settings.activeProfile.path)}
        ${renderStatusItem('Config', `${settings.files.config.exists ? 'Found' : 'Missing'} — ${settings.paths.configPath}`)}
        ${renderStatusItem('Auth', `${authBadge} (${settings.auth.source})`)}
        ${renderStatusItem('Credential status', credentials)}
      </div>
      ${settings.diagnostics.length > 0 ? `<div class="character-settings__warnings"><strong>Diagnostics</strong><ul>${settings.diagnostics.map((diagnostic) => `<li>${escapeHtml(diagnostic)}</li>`).join('')}</ul></div>` : ''}
      <div class="hermes-settings__actions">
        <button class="action-button" type="button" data-hermes-native-save ${disabledAttr}>Save Model Settings</button>
        <button class="ghost-button" type="button" data-hermes-native-test ${disabledAttr}>Test saved auth status</button>
      </div>
      ${modelAuthResult ? `<pre class="settings-panel__empty hermes-settings__health" data-hermes-native-result>${escapeHtml(modelAuthResult)}</pre>` : ''}
    </div>
  `
}

function renderProviderSelect(settings: HermesModelAuthSettings, disabledAttr: string): string {
  const providerId = settings.provider.trim().toLowerCase()
  const hasProviderOption = settings.providerOptions.some((option) => option.id === providerId)
  const customSelected = !hasProviderOption
  const options = settings.providerOptions.map((option) => {
    const selected = !customSelected && option.id === providerId ? 'selected' : ''
    const badge = option.current ? 'current' : option.configured ? 'configured' : option.local ? 'local' : 'available'
    const sourceLabel = option.sources.map(formatOptionSource).join(', ')
    return `<option value="${escapeHtml(option.id)}" ${selected}>${escapeHtml(option.label)} — ${escapeHtml(badge)} · ${escapeHtml(sourceLabel)}</option>`
  }).join('')

  return `
    <label class="character-settings__field hermes-settings__field">
      <span class="character-settings__editor-label">Provider</span>
      <select class="character-settings__input" data-hermes-native-provider ${disabledAttr}>
        ${options}
        <option value="${CUSTOM_SELECT_VALUE}" ${customSelected ? 'selected' : ''}>Custom / manual provider…</option>
      </select>
      <input class="character-settings__input hermes-settings__custom-input" type="text" data-hermes-native-provider-custom value="${escapeHtml(customSelected ? settings.provider : '')}" placeholder="provider-id" ${customSelected ? '' : 'hidden'} ${disabledAttr || !customSelected ? 'disabled' : ''} />
      <span class="character-settings__hint">Providers include current/configured Hermes credentials, auth files, user config, profile config, local signals, and upstream canonical options. Source: ${escapeHtml(formatOptionSource(settings.sources.provider))}.</span>
    </label>
  `
}

function renderModelSelect(settings: HermesModelAuthSettings, disabledAttr: string): string {
  const options = settings.modelOptions
  const hasModelOption = options.some((option) => option.id === settings.model)
  const customSelected = !hasModelOption
  return `
    <label class="character-settings__field hermes-settings__field">
      <span class="character-settings__editor-label">Model</span>
      <select class="character-settings__input" data-hermes-native-model ${disabledAttr}>
        ${renderModelSelectOptions(settings, settings.provider, settings.model)}
      </select>
      <input class="character-settings__input hermes-settings__custom-input" type="text" data-hermes-native-model-custom value="${escapeHtml(customSelected ? settings.model : '')}" placeholder="provider/model-or-model-id" ${customSelected ? '' : 'hidden'} ${disabledAttr || !customSelected ? 'disabled' : ''} />
      <span class="character-settings__hint">Options update when provider changes. Current, user-configured, profile, and curated Hermes catalog models are included; choose Custom for uncataloged models. Source: ${escapeHtml(formatOptionSource(settings.sources.model))}.</span>
    </label>
  `
}

function renderModelSelectOptions(
  settings: HermesModelAuthSettings,
  provider: string,
  selectedModel: string
): string {
  const providerKey = provider.trim().toLowerCase()
  const catalogOptions = settings.modelCatalog[providerKey] ?? settings.modelCatalog.custom ?? []
  const options = ensureModelOption(catalogOptions, selectedModel, providerKey)
  const hasSelected = options.some((option) => option.id === selectedModel)
  return `${options.map((option) => {
    const selected = hasSelected && option.id === selectedModel ? 'selected' : ''
    const badge = option.current ? 'current' : formatOptionSource(option.source)
    return `<option value="${escapeHtml(option.id)}" ${selected}>${escapeHtml(option.label)} — ${escapeHtml(badge)}</option>`
  }).join('')}
    <option value="${CUSTOM_SELECT_VALUE}" ${hasSelected ? '' : 'selected'}>Custom / manual model…</option>`
}

function ensureModelOption(options: HermesModelOption[], selectedModel: string, provider: string): HermesModelOption[] {
  if (!selectedModel || options.some((option) => option.id === selectedModel)) {
    return options
  }
  return [
    {
      id: selectedModel,
      label: selectedModel,
      provider,
      current: true,
      source: 'current',
      detail: 'Current configured Hermes model.'
    },
    ...options
  ]
}


function formatOptionSource(source: string): string {
  switch (source) {
    case 'bonzi-env': return 'Bonzi env override'
    case 'process-env': return 'process env'
    case 'hermes-env': return 'active .env'
    case 'hermes-config': return 'active config'
    case 'auth-json': return 'auth store'
    case 'profile-config': return 'profile config'
    case 'user-config': return 'user config'
    case 'local-default': return 'local/default'
    case 'canonical': return 'canonical'
    case 'catalog': return 'curated catalog'
    case 'current': return 'current'
    case 'default': return 'default'
    case 'missing': return 'missing'
    default: return source
  }
}

function renderStatusItem(label: string, value: string): string {
  return `
    <div class="hermes-settings__status-item">
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(value)}</small>
    </div>
  `
}

function renderInput(
  label: string,
  field: string,
  value: string,
  hint: string,
  disabled: string,
  type = 'text'
): string {
  return `
    <label class="character-settings__field hermes-settings__field">
      <span class="character-settings__editor-label">${escapeHtml(label)}</span>
      <input class="character-settings__input" type="${type}" data-hermes-${field} value="${escapeHtml(value)}" ${disabled} />
      <span class="character-settings__hint">${escapeHtml(hint)}</span>
    </label>
  `
}

function renderNumberInput(
  label: string,
  field: string,
  value: number,
  hint: string,
  disabled: string
): string {
  return `
    <label class="character-settings__field hermes-settings__field">
      <span class="character-settings__editor-label">${escapeHtml(label)}</span>
      <input class="character-settings__input" type="number" min="1" step="1" data-hermes-${field} value="${value}" ${disabled} />
      <span class="character-settings__hint">${escapeHtml(hint)}</span>
    </label>
  `
}

function isHermesHealthKind(value: string | undefined): value is HermesHealthCheckKind {
  return value === 'status' || value === 'cron' || value === 'gateway'
}
