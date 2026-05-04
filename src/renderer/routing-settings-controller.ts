import type {
  RuntimeRoutingRule,
  RuntimeRoutingRuleMatch,
  RuntimeRoutingSettings
} from '../shared/contracts/routing-rules'
import { escapeHtml } from './html-utils'

interface RoutingSettingsControllerOptions {
  routingSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  onSavingChange(saving: boolean): void
}

export interface RoutingSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

const DEFAULT_GROW_ROOM_PROMPT = [
  'Read-only: inspect the available grow-room context, sensors, schedules, automations, Hermes memory, and skills.',
  'Answer the user command for Eliza with current status, risks, assumptions, and suggested next steps.',
  '',
  'User command: {{command}}'
].join('\n')

export function createRoutingSettingsController(
  options: RoutingSettingsControllerOptions
): RoutingSettingsController {
  let draft: RuntimeRoutingSettings = { enabled: true, rules: [] }

  const hydrate = async (): Promise<void> => {
    renderLoading()
    try {
      const response = await window.bonzi.settings.getRuntimeRoutingSettings()
      draft = cloneSettings(response.settings)
      render(response.warnings)
    } catch (error) {
      options.setStatusMessage(`Routing settings failed to load: ${String(error)}`)
      render([])
    }
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const action = target.dataset.routingAction
    if (!action) {
      return
    }

    if (action === 'add-hermes-rule') {
      draft.rules.push(createDefaultHermesRule())
      render([])
      return
    }

    if (action === 'save') {
      void save()
      return
    }

    const index = Number(target.dataset.routingRuleIndex)
    if (!Number.isInteger(index) || !draft.rules[index]) {
      return
    }

    if (action === 'delete-rule') {
      draft.rules.splice(index, 1)
      render([])
    }
  }

  const handleInput = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target.dataset.routingGlobal === 'enabled') {
      draft.enabled = target instanceof HTMLInputElement ? target.checked : draft.enabled
      return
    }

    const index = Number(target.dataset.routingRuleIndex)
    const field = target.dataset.routingField
    const rule = Number.isInteger(index) ? draft.rules[index] : undefined
    if (!rule || !field) {
      return
    }

    updateRuleDraft(rule, field, target)
    if (field === 'matchKind' || field === 'actionType') {
      render([])
    }
  }

  const save = async (): Promise<void> => {
    options.onSavingChange(true)
    options.setStatusMessage('Saving routing rules…')
    try {
      const response = await window.bonzi.settings.updateRuntimeRoutingSettings(draft)
      draft = cloneSettings(response.settings)
      render(response.warnings)
      options.setStatusMessage(response.warnings.length > 0
        ? `Routing rules saved with ${response.warnings.length} warning${response.warnings.length === 1 ? '' : 's'}.`
        : 'Routing rules saved. New commands use them immediately.'
      )
    } catch (error) {
      options.setStatusMessage(`Routing rules failed to save: ${String(error)}`)
    } finally {
      options.onSavingChange(false)
    }
  }

  const renderLoading = (): void => {
    options.routingSettingsEl.innerHTML = '<p class="settings-panel__empty">Loading routing rules…</p>'
  }

  const render = (warnings: string[]): void => {
    options.routingSettingsEl.innerHTML = [
      '<div class="settings-panel__section-header">',
      '<h3 class="settings-panel__section-title">Routing rules</h3>',
      '<p class="settings-panel__section-copy">Default matching commands to configured Bonzi actions, such as consulting Hermes for grow-room questions. Eliza still receives the observation and decides the final answer.</p>',
      '</div>',
      renderWarnings(warnings),
      '<label class="settings-toggle-card settings-card">',
      '<span><strong>Enable routing rules</strong><small>When off, commands go straight to Eliza without deterministic routing.</small></span>',
      `<input type="checkbox" data-routing-global="enabled" ${draft.enabled ? 'checked' : ''} />`,
      '</label>',
      '<div class="routing-settings__actions">',
      '<button class="ghost-button" type="button" data-routing-action="add-hermes-rule">Add Hermes rule</button>',
      '<button class="action-button" type="button" data-routing-action="save">Save routing rules</button>',
      '</div>',
      draft.rules.length === 0
        ? '<p class="settings-panel__empty">No routing rules yet. Add a Hermes rule to get started.</p>'
        : draft.rules.map(renderRule).join('')
    ].join('')
  }

  const renderRule = (rule: RuntimeRoutingRule, index: number): string => {
    const keywords = rule.match.kind === 'keyword' ? rule.match.keywords.join('\n') : ''
    const pattern = rule.match.kind === 'regex' ? rule.match.pattern : ''
    const prompt = rule.target.params.prompt ?? ''
    const query = rule.target.params.query ?? ''
    return [
      `<article class="settings-card routing-settings__rule" data-routing-rule-card="${index}">`,
      '<div class="settings-panel__section-header">',
      `<h4>${escapeHtml(rule.name || `Routing rule ${index + 1}`)}</h4>`,
      `<button class="ghost-button ghost-button--danger" type="button" data-routing-action="delete-rule" data-routing-rule-index="${index}">Delete</button>`,
      '</div>',
      '<div class="routing-settings__grid">',
      renderTextInput(index, 'name', 'Name', rule.name),
      renderNumberInput(index, 'priority', 'Priority', String(rule.priority)),
      renderCheckbox(index, 'enabled', 'Enabled', rule.enabled),
      renderCheckbox(index, 'stopOnMatch', 'Stop on match', rule.stopOnMatch),
      renderSelect(index, 'matchKind', 'Match kind', rule.match.kind, [
        ['keyword', 'Keywords'],
        ['regex', 'Regex']
      ]),
      rule.match.kind === 'keyword'
        ? renderSelect(index, 'keywordMode', 'Keyword mode', rule.match.mode, [
            ['any', 'Any keyword'],
            ['all', 'All keywords']
          ])
        : renderTextInput(index, 'regexPattern', 'Regex pattern', pattern),
      renderCheckbox(index, 'caseSensitive', 'Case sensitive', rule.match.caseSensitive),
      renderSelect(index, 'actionType', 'Target action', rule.target.actionType, [
        ['hermes-run', 'Consult Hermes'],
        ['inspect-cron-jobs', 'Inspect Hermes cron']
      ]),
      '</div>',
      rule.match.kind === 'keyword'
        ? renderTextarea(index, 'keywords', 'Keywords, one per line', keywords, 4)
        : '',
      rule.target.actionType === 'hermes-run'
        ? renderTextarea(index, 'prompt', 'Prompt template', prompt, 7)
        : renderTextInput(index, 'query', 'Cron query template', query),
      '<p class="settings-panel__section-copy">Templates support {{command}}, {{ruleName}}, {{match}}, {{keyword}}, and regex captures like {{capture.1}}.</p>',
      '</article>'
    ].join('')
  }

  options.routingSettingsEl.addEventListener('click', handleClick)
  options.routingSettingsEl.addEventListener('input', handleInput)

  return {
    hydrate,
    dispose: () => {
      options.routingSettingsEl.removeEventListener('click', handleClick)
      options.routingSettingsEl.removeEventListener('input', handleInput)
    }
  }
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return ''
  }

  return `<ul class="settings-panel__empty routing-settings__warnings">${warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join('')}</ul>`
}

function renderTextInput(index: number, field: string, label: string, value: string): string {
  return `<label class="character-settings__field"><span>${escapeHtml(label)}</span><input class="character-settings__input" data-routing-rule-index="${index}" data-routing-field="${field}" value="${escapeHtml(value)}" /></label>`
}

function renderNumberInput(index: number, field: string, label: string, value: string): string {
  return `<label class="character-settings__field"><span>${escapeHtml(label)}</span><input class="character-settings__input" type="number" data-routing-rule-index="${index}" data-routing-field="${field}" value="${escapeHtml(value)}" /></label>`
}

function renderCheckbox(index: number, field: string, label: string, checked: boolean): string {
  return `<label class="character-settings__field character-settings__field--inline"><span>${escapeHtml(label)}</span><input type="checkbox" data-routing-rule-index="${index}" data-routing-field="${field}" ${checked ? 'checked' : ''} /></label>`
}

function renderTextarea(index: number, field: string, label: string, value: string, rows: number): string {
  return `<label class="character-settings__field"><span>${escapeHtml(label)}</span><textarea class="character-settings__editor" rows="${rows}" data-routing-rule-index="${index}" data-routing-field="${field}">${escapeHtml(value)}</textarea></label>`
}

function renderSelect(
  index: number,
  field: string,
  label: string,
  value: string,
  options: Array<[string, string]>
): string {
  return `<label class="character-settings__field"><span>${escapeHtml(label)}</span><select class="character-settings__input" data-routing-rule-index="${index}" data-routing-field="${field}">${options
    .map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`)
    .join('')}</select></label>`
}

function updateRuleDraft(
  rule: RuntimeRoutingRule,
  field: string,
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): void {
  const value = target instanceof HTMLInputElement && target.type === 'checkbox'
    ? target.checked
    : target.value

  switch (field) {
    case 'name':
      rule.name = String(value)
      break
    case 'priority':
      rule.priority = Number.parseInt(String(value), 10) || 0
      break
    case 'enabled':
      rule.enabled = Boolean(value)
      break
    case 'stopOnMatch':
      rule.stopOnMatch = Boolean(value)
      break
    case 'caseSensitive':
      rule.match.caseSensitive = Boolean(value)
      break
    case 'matchKind':
      rule.match = value === 'regex'
        ? { kind: 'regex', pattern: '', caseSensitive: rule.match.caseSensitive }
        : { kind: 'keyword', keywords: [], mode: 'any', caseSensitive: rule.match.caseSensitive }
      break
    case 'keywordMode':
      if (rule.match.kind === 'keyword') {
        rule.match.mode = value === 'all' ? 'all' : 'any'
      }
      break
    case 'keywords':
      if (rule.match.kind === 'keyword') {
        rule.match.keywords = String(value)
          .split(/\r?\n/u)
          .map((keyword) => keyword.trim())
          .filter(Boolean)
      }
      break
    case 'regexPattern':
      if (rule.match.kind === 'regex') {
        rule.match.pattern = String(value)
      }
      break
    case 'actionType':
      rule.target.actionType = value === 'inspect-cron-jobs'
        ? 'inspect-cron-jobs'
        : 'hermes-run'
      rule.target.params = rule.target.actionType === 'hermes-run'
        ? { prompt: rule.target.params.prompt || DEFAULT_GROW_ROOM_PROMPT }
        : { query: rule.target.params.query || '{{command}}' }
      break
    case 'prompt':
      rule.target.params.prompt = String(value)
      break
    case 'query':
      rule.target.params.query = String(value)
      break
  }
}

function createDefaultHermesRule(): RuntimeRoutingRule {
  return {
    id: `routing-rule-${crypto.randomUUID()}`,
    enabled: true,
    name: 'Grow room questions consult Hermes',
    priority: 100,
    match: {
      kind: 'keyword',
      keywords: ['grow room', 'vpd', 'humidity', 'soil moisture', 'dehumidifier', 'lights'],
      mode: 'any',
      caseSensitive: false
    },
    target: {
      actionType: 'hermes-run',
      params: {
        prompt: DEFAULT_GROW_ROOM_PROMPT
      }
    },
    stopOnMatch: true
  }
}

function cloneSettings(settings: RuntimeRoutingSettings): RuntimeRoutingSettings {
  return JSON.parse(JSON.stringify(settings)) as RuntimeRoutingSettings
}
