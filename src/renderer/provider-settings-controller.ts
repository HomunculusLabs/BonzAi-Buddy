import type {
  AssistantProviderKind,
  AssistantProviderSettings,
  ListPiAiModelOptionsResult,
  PiAiModelOption,
  UpdateAssistantProviderSettingsRequest
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

interface ProviderSettingsControllerOptions {
  providerSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  onSavingChange(saving: boolean): void
}

export interface ProviderSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

type ProviderSettingsDraft = Required<Pick<UpdateAssistantProviderSettingsRequest, 'provider'>> & {
  openaiCompatible: {
    baseUrl: string
    model: string
  }
  piAi: {
    agentDir: string
    modelSpec: string
    smallModelSpec: string
    largeModelSpec: string
    priority: string
  }
}

export function createProviderSettingsController(
  options: ProviderSettingsControllerOptions
): ProviderSettingsController {
  const { providerSettingsEl } = options
  let settings: AssistantProviderSettings | null = null
  let draft: ProviderSettingsDraft | null = null
  let piModelOptions: ListPiAiModelOptionsResult = { ok: true, models: [] }
  let isHydrated = false
  let isSaving = false
  let isLoadingPiModels = false

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
      settings = await window.bonzi.settings.getAssistantProviderSettings()
      draft = createDraftFromSettings(settings)
      piModelOptions = await loadPiModelOptions(draft.piAi.agentDir)
      isHydrated = true
      render()
    } catch (error) {
      isHydrated = true
      options.setStatusMessage(`Failed to load provider settings: ${String(error)}`)
      render()
    }
  }

  const render = (): void => {
    const currentDraft = draft ?? createDraftFromSettings(settings)
    const provider = currentDraft.provider
    const disabled = !window.bonzi || !isHydrated || isSaving ? 'disabled' : ''
    const piModelsDisabled = disabled || isLoadingPiModels ? 'disabled' : ''
    const sourceLabel = settings?.source === 'settings'
      ? 'Set in Bonzi Settings'
      : 'Using environment/defaults'

    providerSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Assistant provider</h3>
        <p class="settings-panel__section-copy">Choose the elizaOS provider and model for Bonzi’s primary Eliza runtime. Hermes secondary runtime settings live in the Hermes tab.</p>
      </div>
      <form class="settings-card provider-settings__card" data-provider-settings-form>
        <label class="approval-continuation-field">
          <span class="approval-continuation-field__copy">
            <strong>Provider</strong>
            <small>${escapeHtml(sourceLabel)}. Current effective provider: ${escapeHtml(settings?.effectiveProvider.label ?? 'Loading…')}</small>
          </span>
          <select class="companion-settings__select" data-provider-kind ${disabled}>
            ${renderProviderOption('eliza-classic', provider, 'Eliza Classic')}
            ${renderProviderOption('openai-compatible', provider, 'OpenAI-compatible')}
            ${renderProviderOption('pi-ai', provider, 'Pi AI')}
          </select>
        </label>

        <div class="provider-settings__group" data-provider-group="openai-compatible" ${provider === 'openai-compatible' ? '' : 'hidden'}>
          <label class="approval-continuation-field">
            <span class="approval-continuation-field__copy">
              <strong>Base URL</strong>
              <small>API keys still come from BONZI_OPENAI_API_KEY.</small>
            </span>
            <input class="approval-continuation-field__input" type="text" data-openai-base-url value="${escapeAttr(currentDraft.openaiCompatible.baseUrl)}" ${disabled} />
          </label>
          <label class="approval-continuation-field">
            <span class="approval-continuation-field__copy">
              <strong>Model</strong>
              <small>Chat/completions model name.</small>
            </span>
            <input class="approval-continuation-field__input" type="text" data-openai-model value="${escapeAttr(currentDraft.openaiCompatible.model)}" ${disabled} />
          </label>
        </div>

        <div class="provider-settings__group" data-provider-group="pi-ai" ${provider === 'pi-ai' ? '' : 'hidden'}>
          <label class="approval-continuation-field">
            <span class="approval-continuation-field__copy">
              <strong>Pi model</strong>
              <small>${escapeHtml(piModelHelpText(piModelOptions, isLoadingPiModels))}</small>
            </span>
            <select class="companion-settings__select" data-pi-model-spec ${piModelsDisabled}>
              ${renderPiModelOptions({
                models: piModelOptions.models,
                selected: currentDraft.piAi.modelSpec,
                defaultModelSpec: piModelOptions.defaultModelSpec
              })}
            </select>
          </label>
          <label class="approval-continuation-field">
            <span class="approval-continuation-field__copy">
              <strong>Pi agent directory</strong>
              <small>Optional path to Pi credentials/settings. Blank uses ~/.pi/agent.</small>
            </span>
            <input class="approval-continuation-field__input" type="text" data-pi-agent-dir value="${escapeAttr(currentDraft.piAi.agentDir)}" ${disabled} />
          </label>
          <div class="workspace-settings__actions">
            <button class="settings-button" type="button" data-pi-refresh-models ${disabled}>${isLoadingPiModels ? 'Refreshing Pi models…' : 'Refresh Pi models'}</button>
          </div>
          ${piModelOptions.ok ? '' : `<p class="settings-panel__empty">Failed to list Pi models: ${escapeHtml(piModelOptions.error ?? 'Unknown error')}</p>`}
          <details class="provider-settings__advanced">
            <summary>Advanced Pi model routing</summary>
            <label class="approval-continuation-field">
              <span class="approval-continuation-field__copy">
                <strong>Small model spec</strong>
                <small>Optional TEXT_SMALL override.</small>
              </span>
              <input class="approval-continuation-field__input" type="text" data-pi-small-model-spec value="${escapeAttr(currentDraft.piAi.smallModelSpec)}" ${disabled} />
            </label>
            <label class="approval-continuation-field">
              <span class="approval-continuation-field__copy">
                <strong>Large model spec</strong>
                <small>Optional TEXT_LARGE override.</small>
              </span>
              <input class="approval-continuation-field__input" type="text" data-pi-large-model-spec value="${escapeAttr(currentDraft.piAi.largeModelSpec)}" ${disabled} />
            </label>
            <label class="approval-continuation-field">
              <span class="approval-continuation-field__copy">
                <strong>Handler priority</strong>
                <small>Higher priority model handlers win.</small>
              </span>
              <input class="approval-continuation-field__input" type="number" min="1" max="100000" step="1" data-pi-priority value="${escapeAttr(currentDraft.piAi.priority)}" ${disabled} />
            </label>
          </details>
        </div>

        <div class="workspace-settings__actions">
          <button class="settings-button" type="submit" ${disabled}>Save provider settings</button>
        </div>
      </form>
      ${!isHydrated ? '<p class="settings-panel__empty">Provider settings are loading…</p>' : ''}
    `
  }

  const handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLSelectElement) || !target.matches('[data-provider-kind]')) {
      return
    }

    syncDraftFromCurrentForm()
    const provider = normalizeProviderKind(target.value)
    if (draft) {
      draft.provider = provider
    }
    for (const group of providerSettingsEl.querySelectorAll<HTMLElement>('[data-provider-group]')) {
      group.hidden = group.dataset.providerGroup !== provider
    }
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-pi-refresh-models]')) {
      return
    }

    void refreshPiModels()
  }

  const handleSubmit = (event: SubmitEvent): void => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-provider-settings-form]')) {
      return
    }

    event.preventDefault()
    void save(form)
  }

  const refreshPiModels = async (): Promise<void> => {
    if (!window.bonzi || isLoadingPiModels) {
      return
    }

    syncDraftFromCurrentForm()
    const agentDir = draft?.piAi.agentDir ?? readInputValue(providerSettingsEl, '[data-pi-agent-dir]')
    isLoadingPiModels = true
    options.setStatusMessage('Refreshing Pi model list…')
    render()

    try {
      piModelOptions = await loadPiModelOptions(agentDir)
      options.setStatusMessage(
        piModelOptions.ok
          ? `Loaded ${piModelOptions.models.length} Pi model${piModelOptions.models.length === 1 ? '' : 's'}.`
          : `Failed to list Pi models: ${piModelOptions.error ?? 'Unknown error'}`
      )
    } finally {
      isLoadingPiModels = false
      render()
    }
  }

  const save = async (form: HTMLFormElement): Promise<void> => {
    if (!window.bonzi || isSaving) {
      return
    }

    const request = readRequestFromForm(form)
    setSaving(true)
    options.setStatusMessage('Saving provider settings…')
    render()

    try {
      settings = await window.bonzi.settings.updateAssistantProviderSettings(request)
      draft = createDraftFromSettings(settings)
      piModelOptions = await loadPiModelOptions(draft.piAi.agentDir)
      options.setRuntimeReloadPending(true)
      options.setStatusMessage('Provider settings saved. Apply Runtime Changes to reload elizaOS.')
    } catch (error) {
      options.setStatusMessage(`Failed to save provider settings: ${String(error)}`)
    } finally {
      setSaving(false)
      render()
    }
  }

  const syncDraftFromCurrentForm = (): void => {
    const form = providerSettingsEl.querySelector<HTMLFormElement>('[data-provider-settings-form]')
    if (!form) {
      return
    }

    draft = createDraftFromRequest(readRequestFromForm(form))
  }

  providerSettingsEl.addEventListener('change', handleChange)
  providerSettingsEl.addEventListener('click', handleClick)
  providerSettingsEl.addEventListener('submit', handleSubmit)
  render()

  return {
    hydrate,
    dispose: () => {
      providerSettingsEl.removeEventListener('change', handleChange)
      providerSettingsEl.removeEventListener('click', handleClick)
      providerSettingsEl.removeEventListener('submit', handleSubmit)
      setSaving(false)
    }
  }
}

async function loadPiModelOptions(
  agentDir: string | undefined
): Promise<ListPiAiModelOptionsResult> {
  if (!window.bonzi || typeof window.bonzi.settings.listPiAiModelOptions !== 'function') {
    return {
      ok: false,
      models: [],
      error: 'Bonzi bridge does not expose Pi model listing. Restart the app after rebuilding.'
    }
  }

  return window.bonzi.settings.listPiAiModelOptions({ agentDir })
}


function createDraftFromSettings(
  settings: AssistantProviderSettings | null
): ProviderSettingsDraft {
  return {
    provider: settings?.provider ?? 'eliza-classic',
    openaiCompatible: {
      baseUrl: settings?.openaiCompatible.baseUrl ?? '',
      model: settings?.openaiCompatible.model ?? ''
    },
    piAi: {
      agentDir: settings?.piAi.agentDir ?? '',
      modelSpec: settings?.piAi.modelSpec ?? '',
      smallModelSpec: settings?.piAi.smallModelSpec ?? '',
      largeModelSpec: settings?.piAi.largeModelSpec ?? '',
      priority: settings?.piAi.priority ?? '10000'
    }
  }
}

function createDraftFromRequest(
  request: UpdateAssistantProviderSettingsRequest
): ProviderSettingsDraft {
  return {
    provider: request.provider,
    openaiCompatible: {
      baseUrl: request.openaiCompatible?.baseUrl ?? '',
      model: request.openaiCompatible?.model ?? ''
    },
    piAi: {
      agentDir: request.piAi?.agentDir ?? '',
      modelSpec: request.piAi?.modelSpec ?? '',
      smallModelSpec: request.piAi?.smallModelSpec ?? '',
      largeModelSpec: request.piAi?.largeModelSpec ?? '',
      priority: request.piAi?.priority ?? '10000'
    }
  }
}

function renderProviderOption(
  value: AssistantProviderKind,
  selected: AssistantProviderKind,
  label: string
): string {
  return `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
}

function renderPiModelOptions(input: {
  models: PiAiModelOption[]
  selected: string
  defaultModelSpec: string | undefined
}): string {
  const selected = input.selected || input.defaultModelSpec || ''

  if (input.models.length === 0 && !selected) {
    return '<option value="">No Pi credential-backed models found</option>'
  }

  const models = ensureSelectedModelPresent(input.models, selected)
  const providers = Array.from(new Set(models.map((model) => model.provider))).sort()

  return [
    '<option value="">Use Pi default</option>',
    ...providers.map((provider) => {
      const options = models
        .filter((model) => model.provider === provider)
        .map((model) => renderPiModelOption(model, selected))
        .join('')
      return `<optgroup label="${escapeAttr(provider)}">${options}</optgroup>`
    })
  ].join('')
}

function renderPiModelOption(model: PiAiModelOption, selected: string): string {
  const label = `${model.name}${model.isDefault ? ' · Pi default' : ''}`
  return `<option value="${escapeAttr(model.id)}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`
}

function ensureSelectedModelPresent(
  models: PiAiModelOption[],
  selected: string
): PiAiModelOption[] {
  if (!selected || models.some((model) => model.id === selected)) {
    return models
  }

  const [provider = 'custom'] = selected.split('/')
  return [
    ...models,
    {
      id: selected,
      name: `${selected} · current custom value`,
      provider,
      isDefault: false
    }
  ]
}

function piModelHelpText(
  result: ListPiAiModelOptionsResult,
  loading: boolean
): string {
  if (loading) {
    return 'Loading credential-backed Pi models…'
  }

  if (!result.ok) {
    return 'Could not load Pi models; check the Pi agent directory or credentials.'
  }

  if (result.models.length === 0) {
    return result.agentDir
      ? `No credential-backed models found in ${result.agentDir}. Sign in/configure providers with Pi, then refresh.`
      : 'No Pi providers with credentials were found. Sign in/configure providers with Pi, then refresh.'
  }

  return result.agentDir
    ? `Only models for credential-backed Pi providers are shown. Loaded from ${result.agentDir}.`
    : 'Only models for Pi providers with credentials are shown.'
}

function readRequestFromForm(
  form: HTMLFormElement
): UpdateAssistantProviderSettingsRequest {
  return {
    provider: normalizeProviderKind(readInputValue(form, '[data-provider-kind]')),
    openaiCompatible: {
      baseUrl: readInputValue(form, '[data-openai-base-url]'),
      model: readInputValue(form, '[data-openai-model]')
    },
    piAi: {
      agentDir: readInputValue(form, '[data-pi-agent-dir]'),
      modelSpec: readInputValue(form, '[data-pi-model-spec]'),
      smallModelSpec: readInputValue(form, '[data-pi-small-model-spec]'),
      largeModelSpec: readInputValue(form, '[data-pi-large-model-spec]'),
      priority: readInputValue(form, '[data-pi-priority]')
    }
  }
}

function readInputValue(root: ParentNode, selector: string): string {
  const element = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)
  return element?.value.trim() ?? ''
}

function normalizeProviderKind(value: string): AssistantProviderKind {
  if (value === 'openai-compatible' || value === 'pi-ai') {
    return value
  }

  return 'eliza-classic'
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/gu, '&quot;')
}
