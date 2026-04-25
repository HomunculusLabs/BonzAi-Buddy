import {
  type AssistantEvent,
  type AssistantEventEmoteId,
  type AssistantMessage,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type ElizaPluginSettings,
  type RuntimeApprovalSettings,
  type ShellState,
  type UpdateElizaPluginSettingsRequest
} from '../shared/contracts'
import { createBubbleWindowLayoutController } from './bubble-window-layout'
import {
  addAssistantTurn,
  applyActionUpdate,
  conversationEntriesFromHistory,
  createMessage,
  renderConversation,
  type ConversationEntry
} from './conversation-view'
import {
  isElizaOptionalPluginId,
  renderPluginSettings
} from './plugin-settings-view'
import { createVrmStage, type VrmStageController } from './vrm-stage'

interface WindowDragState {
  pointerId: number
  startBounds: {
    x: number
    y: number
  }
  startScreen: {
    x: number
    y: number
  }
}

type AppReadyState = 'loading' | 'ready' | 'error'

function shellStateMarkup(state: ShellState): string {
  return JSON.stringify(state, null, 2)
}

function shellStageForRuntimeStatus(
  status: AssistantRuntimeStatus
): ShellState['stage'] {
  switch (status.state) {
    case 'starting':
      return 'runtime-starting'
    case 'ready':
      return 'assistant-ready'
    case 'error':
      return 'runtime-error'
  }
}

export function renderApp(root: HTMLDivElement): void {
  const disableVrm =
    new URLSearchParams(window.location.search).get('bonziDisableVrm') === '1'

  root.innerHTML = `
    <main class="shell shell--ui-hidden" data-app-ready="loading">
      <header class="titlebar" aria-label="Window controls and drag area">
        <div class="titlebar__brand">
          <span class="titlebar__dot"></span>
          <div>
            <div>Bonzi Companion</div>
            <p class="titlebar__caption">UI Item 1 — speech bubble assistant</p>
          </div>
        </div>
        <div class="titlebar__actions">
          <button class="window-button" data-action="settings" type="button" aria-label="Open settings">⚙</button>
          <button class="window-button" data-action="minimize" type="button">–</button>
          <button class="window-button window-button--danger" data-action="close" type="button">×</button>
        </div>
      </header>

      <aside class="settings-panel" data-settings-panel hidden aria-label="Settings">
        <header class="settings-panel__header">
          <div>
            <h2>Settings</h2>
            <p>Manage autonomy and elizaOS plugins loaded by Bonzi.</p>
          </div>
          <button class="window-button" data-action="settings-close" type="button" aria-label="Close settings">×</button>
        </header>
        <div class="settings-panel__section" data-approval-settings></div>
        <div class="settings-panel__plugins" data-plugin-settings></div>
        <p class="settings-panel__status" data-settings-status aria-live="polite"></p>
        <button
          class="ghost-button"
          data-action="apply-runtime-changes"
          type="button"
          hidden
        >
          Apply Runtime Changes
        </button>
      </aside>

      <section class="stage-card">
        <div class="stage-card__copy" aria-live="polite">
          <span class="sr-only" data-vrm-status>Preparing renderer…</span>
          <span class="sr-only" data-provider-label>Loading provider…</span>
          <button class="ghost-button" data-role="vrm-retry" type="button" hidden>
            Retry load
          </button>
          <p class="muted stage-card__error" data-vrm-error hidden></p>
        </div>

        <div class="speech-bubble-shell" aria-live="polite">
          <div class="speech-bubble" data-chat-log aria-label="Bonzi speech bubble"></div>
        </div>

        <div class="stage-shell">
          <canvas class="stage-canvas" data-vrm-canvas aria-label="Bonzi VRM stage"></canvas>
        </div>
      </section>

      <section class="command-dock" aria-label="Assistant command launcher">
        <div class="debug-readouts" hidden>
          <span data-provider-pill>Awaiting state…</span>
        </div>

        <form class="chat-form chat-form--dock" data-chat-form>
          <label class="sr-only" for="assistant-command">Command</label>
          <div class="chat-form__row">
            <input
              id="assistant-command"
              class="chat-input"
              name="command"
              type="text"
              autocomplete="off"
              placeholder="Type a command for Bonzi"
            />
            <button class="action-button" data-role="assistant-send" type="submit">
              Send
            </button>
          </div>
        </form>

        <div class="debug-readouts" hidden>
          <code class="inline-code" data-vrm-path>Loading asset path…</code>
          <pre class="state-block" data-shell-state>Loading shell metadata…</pre>
        </div>
      </section>
    </main>
  `

  const shellStateEl = root.querySelector<HTMLElement>('[data-shell-state]')
  const settingsButton = root.querySelector<HTMLButtonElement>(
    '[data-action="settings"]'
  )
  const settingsCloseButton = root.querySelector<HTMLButtonElement>(
    '[data-action="settings-close"]'
  )
  const minimizeButton = root.querySelector<HTMLButtonElement>(
    '[data-action="minimize"]'
  )
  const closeButton = root.querySelector<HTMLButtonElement>('[data-action="close"]')
  const vrmCanvas = root.querySelector<HTMLCanvasElement>('[data-vrm-canvas]')
  const stageShellEl = root.querySelector<HTMLElement>('.stage-shell')
  const shellEl = root.querySelector<HTMLElement>('.shell')
  const vrmStatusEl = root.querySelector<HTMLElement>('[data-vrm-status]')
  const vrmErrorEl = root.querySelector<HTMLElement>('[data-vrm-error]')
  const vrmRetryButton = root.querySelector<HTMLButtonElement>('[data-role="vrm-retry"]')
  const vrmPathEl = root.querySelector<HTMLElement>('[data-vrm-path]')
  const providerLabelEl = root.querySelector<HTMLElement>('[data-provider-label]')
  const providerPillEl = root.querySelector<HTMLElement>('[data-provider-pill]')
  const chatLogEl = root.querySelector<HTMLElement>('[data-chat-log]')
  const chatFormEl = root.querySelector<HTMLFormElement>('[data-chat-form]')
  const chatInputEl = root.querySelector<HTMLInputElement>('#assistant-command')
  const assistantSendButton = root.querySelector<HTMLButtonElement>(
    '[data-role="assistant-send"]'
  )
  const settingsPanelEl = root.querySelector<HTMLElement>('[data-settings-panel]')
  const approvalSettingsEl = root.querySelector<HTMLElement>(
    '[data-approval-settings]'
  )
  const pluginSettingsEl = root.querySelector<HTMLElement>('[data-plugin-settings]')
  const settingsStatusEl = root.querySelector<HTMLElement>('[data-settings-status]')
  const applyRuntimeChangesButton = root.querySelector<HTMLButtonElement>(
    '[data-action="apply-runtime-changes"]'
  )

  if (
    !shellStateEl ||
    !settingsButton ||
    !settingsCloseButton ||
    !minimizeButton ||
    !closeButton ||
    !vrmCanvas ||
    !stageShellEl ||
    !shellEl ||
    !vrmStatusEl ||
    !vrmErrorEl ||
    !vrmRetryButton ||
    !vrmPathEl ||
    !providerLabelEl ||
    !providerPillEl ||
    !chatLogEl ||
    !chatFormEl ||
    !chatInputEl ||
    !assistantSendButton ||
    !settingsPanelEl ||
    !approvalSettingsEl ||
    !pluginSettingsEl ||
    !settingsStatusEl ||
    !applyRuntimeChangesButton
  ) {
    throw new Error('Renderer shell did not mount expected controls.')
  }

  const setAssistantInputEnabled = (enabled: boolean): void => {
    chatInputEl.disabled = !enabled
    assistantSendButton.disabled = !enabled
  }

  const setAppReadyState = (state: AppReadyState): void => {
    shellEl.dataset.appReady = state
  }

  const syncSettingsStatusUi = (): void => {
    const runtimeMessage = isRuntimeReloadPending
      ? 'Runtime plugin changes are pending. Apply Runtime Changes to reload elizaOS now.'
      : ''
    settingsStatusEl.textContent = [settingsStatusMessage, runtimeMessage]
      .filter((value) => value.trim().length > 0)
      .join(' ')

    applyRuntimeChangesButton.hidden = !isRuntimeReloadPending
    applyRuntimeChangesButton.disabled =
      isSavingSettings || isSavingApprovalSettings || isApplyingRuntimeChanges
  }

  const setSettingsStatus = (message: string): void => {
    settingsStatusMessage = message
    syncSettingsStatusUi()
  }

  const setRuntimeReloadPending = (pending: boolean): void => {
    isRuntimeReloadPending = pending
    syncSettingsStatusUi()
  }

  const rerenderPluginSettings = (): void => {
    renderPluginSettings(pluginSettingsEl, pluginSettings, {
      isSaving: isSavingSettings
    })
    syncSettingsStatusUi()
  }

  const rerenderApprovalSettings = (): void => {
    const approvalsEnabled = approvalSettings?.approvalsEnabled !== false
    approvalSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Action approvals</h3>
        <p class="settings-panel__section-copy">
          ${approvalsEnabled
            ? 'Sensitive action cards, workflow steps, and plugin operations pause for approval.'
            : 'Actions, workflows, and plugin operations that would normally ask approval continue automatically.'}
        </p>
      </div>
      <label class="plugin-row approval-settings-row">
        <span class="plugin-row__copy">
          <span class="plugin-row__title">
            Bonzi approvals
            <span class="plugin-row__status">${approvalsEnabled ? 'Enabled' : 'Autonomous'}</span>
          </span>
          <span class="plugin-row__description">
            Turn this off for more autonomy. Disabling requires explicit confirmation once.
          </span>
        </span>
        <span class="plugin-row__action-group">
          <span>${approvalsEnabled ? 'On' : 'Off'}</span>
          <input
            class="plugin-row__toggle"
            type="checkbox"
            data-approval-toggle
            ${approvalsEnabled ? 'checked' : ''}
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </span>
      </label>
    `
  }

  const discoverPluginSettings = async (): Promise<ElizaPluginSettings> => {
    if (!window.bonzi) {
      throw new Error('Bonzi bridge unavailable')
    }

    if (typeof window.bonzi.plugins?.discover !== 'function') {
      return window.bonzi.settings.getElizaPlugins()
    }

    try {
      return await window.bonzi.plugins.discover({
        includeInstalled: true
      } as unknown as Parameters<typeof window.bonzi.plugins.discover>[0])
    } catch {
      return window.bonzi.plugins.discover({})
    }
  }

  const hydratePluginSettings = async (options: {
    preserveStatus?: boolean
  } = {}): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      if (!options.preserveStatus) {
        setSettingsStatus('')
      }
      pluginSettings = await discoverPluginSettings()
      for (const pluginId of pendingPluginInstallConfirmations.keys()) {
        if (!pluginSettings.availablePlugins.some((plugin) => plugin.id === pluginId)) {
          pendingPluginInstallConfirmations.delete(pluginId)
        }
      }
      rerenderPluginSettings()
    } catch {
      try {
        pluginSettings = await window.bonzi.settings.getElizaPlugins()
        for (const pluginId of pendingPluginInstallConfirmations.keys()) {
          if (!pluginSettings.availablePlugins.some((plugin) => plugin.id === pluginId)) {
            pendingPluginInstallConfirmations.delete(pluginId)
          }
        }
        rerenderPluginSettings()
      } catch (error) {
        setSettingsStatus(`Failed to load plugin settings: ${String(error)}`)
      }
    }
  }

  const hydrateApprovalSettings = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      approvalSettings = await window.bonzi.settings.getRuntimeApprovalSettings()
      rerenderApprovalSettings()
      rerenderConversation()
    } catch (error) {
      setSettingsStatus(`Failed to load approval settings: ${String(error)}`)
    }
  }

  const setSettingsVisible = (visible: boolean): void => {
    isSettingsVisible = visible
    settingsPanelEl.hidden = !visible
    shellEl.classList.toggle('shell--settings-open', visible)

    if (visible) {
      void hydrateApprovalSettings()
      void hydratePluginSettings()
    }
  }

  let shellState: ShellState | null = null
  const conversation: ConversationEntry[] = []
  const workflowRunsById = new Map<string, BonziWorkflowRunSnapshot>()
  const pendingConfirmations = new Set<string>()
  let isUiVisible = false
  let isAwaitingAssistant = false
  let dragState: WindowDragState | null = null
  let pendingStageEmote: AssistantEventEmoteId | null = null
  let pendingRuntimeStatus: AssistantRuntimeStatus | null = null
  let pluginSettings: ElizaPluginSettings | null = null
  let approvalSettings: RuntimeApprovalSettings | null = null
  const pendingPluginInstallConfirmations = new Map<string, string>()
  let isSettingsVisible = false
  let isSavingSettings = false
  let isSavingApprovalSettings = false
  let isApplyingRuntimeChanges = false
  let isRuntimeReloadPending = false
  let settingsStatusMessage = ''
  let unsubscribeAssistantEvents: (() => void) | null = null

  const bubbleWindowLayout = createBubbleWindowLayoutController({
    chatLogEl,
    shellEl
  })

  const syncBubbleWindowLayout = (): void => {
    bubbleWindowLayout.sync({
      entries: conversation,
      isUiVisible,
      isAwaitingAssistant,
      hasVrmError: !vrmErrorEl.hidden
    })
  }

  setAssistantInputEnabled(false)
  setAppReadyState('loading')

  renderConversation(chatLogEl, conversation, pendingConfirmations, {
    isAwaitingAssistant,
    isUiVisible,
    approvalsEnabled: true
  })
  rerenderPluginSettings()
  rerenderApprovalSettings()

  const setUiVisible = (visible: boolean): void => {
    isUiVisible = visible
    rerenderConversation()

    if (visible) {
      window.requestAnimationFrame(() => {
        chatInputEl.focus()
        chatInputEl.select()
      })
    }
  }

  const rerenderConversation = (): void => {
    renderConversation(chatLogEl, conversation, pendingConfirmations, {
      isAwaitingAssistant,
      isUiVisible,
      approvalsEnabled: approvalSettings?.approvalsEnabled !== false
    })
    syncBubbleWindowLayout()
  }

  const rememberWorkflowRun = (
    run: BonziWorkflowRunSnapshot
  ): BonziWorkflowRunSnapshot => {
    const existing = workflowRunsById.get(run.id)

    if (existing && existing.revision >= run.revision) {
      return existing
    }

    workflowRunsById.set(run.id, run)

    for (const entry of conversation) {
      if (entry.workflowRun?.id === run.id) {
        entry.workflowRun = run
      }
    }

    return run
  }

  const applyWorkflowRunUpdate = (run: BonziWorkflowRunSnapshot): boolean => {
    const existing = workflowRunsById.get(run.id)

    if (existing && existing.revision >= run.revision) {
      return false
    }

    rememberWorkflowRun(run)
    return true
  }

  const hydrateConversation = (messages: AssistantMessage[]): void => {
    conversation.splice(
      0,
      conversation.length,
      ...conversationEntriesFromHistory(messages)
    )
    rerenderConversation()
  }

  const setProviderLabel = (label: string): void => {
    providerLabelEl.textContent = label
    providerPillEl.textContent = label
  }

  const applyShellState = (state: ShellState): void => {
    const nextState =
      pendingRuntimeStatus === null
        ? state
        : {
            ...state,
            stage: shellStageForRuntimeStatus(pendingRuntimeStatus),
            assistant: {
              ...state.assistant,
              runtime: pendingRuntimeStatus
            }
          }

    shellState = nextState
    approvalSettings = nextState.assistant.approvals
    shellStateEl.textContent = shellStateMarkup(nextState)
    vrmPathEl.textContent = nextState.vrmAssetPath
    setProviderLabel(nextState.assistant.provider.label)
    rerenderApprovalSettings()
  }

  const submitPluginSettingsUpdate = async (
    request: UpdateElizaPluginSettingsRequest,
    pendingStatus: string
  ): Promise<void> => {
    if (!window.bonzi || isSavingSettings) {
      return
    }

    const previousEnabledById = new Map(
      (pluginSettings?.installedPlugins ?? []).map((plugin) => [
        plugin.id,
        plugin.enabled
      ])
    )

    isSavingSettings = true
    rerenderPluginSettings()
    setSettingsStatus(pendingStatus)

    try {
      await window.bonzi.settings.updateElizaPlugins(request)
      await hydratePluginSettings({ preserveStatus: true })

      const enabledChanged = request.operations.some((operation) => {
        if (operation.type !== 'set-enabled') {
          return false
        }

        const previousEnabled = previousEnabledById.get(operation.id)
        const nextEnabled = pluginSettings?.installedPlugins.find(
          (plugin) => plugin.id === operation.id
        )?.enabled

        return (
          typeof previousEnabled === 'boolean' &&
          typeof nextEnabled === 'boolean' &&
          previousEnabled !== nextEnabled
        )
      })

      if (enabledChanged) {
        setRuntimeReloadPending(true)
      }

      setSettingsStatus(
        enabledChanged
          ? 'Saved plugin settings.'
          : 'Saved plugin settings. Discovery inventory refreshed.'
      )
      const nextShellState = await window.bonzi.app.getShellState()
      applyShellState(nextShellState)
    } catch (error) {
      setSettingsStatus(`Failed to save plugin settings: ${String(error)}`)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
    }
  }

  const syncRuntimeStatus = (status: AssistantRuntimeStatus): void => {
    pendingRuntimeStatus = status

    if (!shellState) {
      return
    }

    applyShellState({
      ...shellState,
      stage: shellStageForRuntimeStatus(status),
      assistant: {
        ...shellState.assistant,
        runtime: status
      }
    })
  }

  const vrmStage: VrmStageController = disableVrm
    ? {
        dispose: () => {},
        load: async () => {
          vrmStatusEl.textContent = 'VRM disabled for automated tests'
          vrmErrorEl.hidden = true
          vrmErrorEl.textContent = ''
          vrmRetryButton.hidden = true
        },
        playBuiltInEmote: () => false
      }
    : createVrmStage(vrmCanvas, {
        onStatusChange: (message) => {
          vrmStatusEl.textContent = message
        },
        onErrorChange: (message) => {
          if (!message) {
            vrmErrorEl.hidden = true
            vrmErrorEl.textContent = ''
            vrmRetryButton.hidden = true
            syncBubbleWindowLayout()
            return
          }

          vrmErrorEl.hidden = false
          vrmErrorEl.textContent = `VRM load error: ${message}`
          vrmRetryButton.hidden = false
          syncBubbleWindowLayout()
        }
      })

  if (disableVrm) {
    vrmStatusEl.textContent = 'VRM disabled for automated tests'
    vrmErrorEl.hidden = true
    vrmErrorEl.textContent = ''
    vrmRetryButton.hidden = true
  }

  const flushPendingStageEmote = (): void => {
    if (!pendingStageEmote) {
      return
    }

    if (vrmStage.playBuiltInEmote(pendingStageEmote)) {
      pendingStageEmote = null
    }
  }

  const handleAssistantEvent = (event: AssistantEvent): void => {
    switch (event.type) {
      case 'runtime-status':
        syncRuntimeStatus(event.status)
        return
      case 'play-emote':
        if (disableVrm) {
          return
        }

        if (vrmStage.playBuiltInEmote(event.emoteId)) {
          pendingStageEmote = null
          return
        }

        pendingStageEmote = event.emoteId
        return
      case 'workflow-run-updated':
        if (applyWorkflowRunUpdate(event.run)) {
          rerenderConversation()
        }
        return
    }
  }

  const loadVrm = async (): Promise<void> => {
    if (!shellState) {
      return
    }

    try {
      await vrmStage.load(shellState.vrmAssetPath)

      if (!disableVrm) {
        flushPendingStageEmote()
      }
    } catch {
      // UI/error state is already updated inside the stage controller.
    }
  }

  const appendSystemMessage = (content: string): void => {
    conversation.push({
      message: createMessage('system', content),
      actions: [],
      warnings: []
    })
    rerenderConversation()
  }

  const autoRunPendingActionCards = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    const pendingActions = conversation.flatMap((entry) =>
      entry.actions.filter(
        (action) =>
          action.status === 'pending' || action.status === 'needs_confirmation'
      )
    )

    for (const action of pendingActions) {
      try {
        const response = await window.bonzi.assistant.executeAction({
          actionId: action.id,
          confirmed: true
        })

        if (response.action) {
          applyActionUpdate(conversation, response.action)
        }
      } catch (error) {
        appendSystemMessage(`Action failed: ${String(error)}`)
      }
    }

    rerenderConversation()
  }

  const installDiscoveredPlugin = async (pluginId: string): Promise<void> => {
    if (!window.bonzi || isSavingSettings || !pluginSettings) {
      return
    }

    const availablePlugin = pluginSettings.availablePlugins.find(
      (plugin) => plugin.id === pluginId
    )

    if (!availablePlugin || isElizaOptionalPluginId(pluginId)) {
      return
    }

    if (!availablePlugin.packageName) {
      setSettingsStatus('Cannot install this plugin because registry metadata did not include a package name.')
      return
    }

    const pendingConfirmationOperationId = pendingPluginInstallConfirmations.get(pluginId)

    isSavingSettings = true
    rerenderPluginSettings()

    try {
      if (!pendingConfirmationOperationId) {
        const previewResult = await window.bonzi.plugins.install({
          id: availablePlugin.id,
          pluginId: availablePlugin.id,
          packageName: availablePlugin.packageName,
          versionRange: availablePlugin.version,
          confirmed: false
        })

        setSettingsStatus(previewResult.message)

        if (previewResult.confirmationRequired) {
          pendingPluginInstallConfirmations.set(
            pluginId,
            previewResult.operation.operationId
          )
          setSettingsStatus(
            'Install preview ready. Click Install again to confirm this third-party plugin install.'
          )
        }

        await hydratePluginSettings({ preserveStatus: true })
        return
      }

      const confirmed =
        approvalSettings?.approvalsEnabled === false ||
        window.confirm(
          `Install plugin "${availablePlugin.name}" now? This will run a package install command in the Bonzi workspace.`
        )

      if (!confirmed) {
        setSettingsStatus('Install cancelled.')
        return
      }

      const previousEnabled =
        pluginSettings.installedPlugins.find((plugin) => plugin.id === pluginId)
          ?.enabled ?? false
      const installResult = await window.bonzi.plugins.install({
        id: availablePlugin.id,
        pluginId: availablePlugin.id,
        packageName: availablePlugin.packageName,
        versionRange: availablePlugin.version,
        confirmed: true,
        confirmationOperationId: pendingConfirmationOperationId
      })

      pendingPluginInstallConfirmations.delete(pluginId)
      setSettingsStatus(installResult.message)
      await hydratePluginSettings({ preserveStatus: true })

      const nextEnabled =
        pluginSettings?.installedPlugins.find((plugin) => plugin.id === pluginId)
          ?.enabled ?? false

      if (previousEnabled !== nextEnabled) {
        setRuntimeReloadPending(true)
      }
    } catch (error) {
      setSettingsStatus(`Failed to install plugin: ${String(error)}`)
      pendingPluginInstallConfirmations.delete(pluginId)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
    }
  }

  const uninstallInstalledPlugin = async (pluginId: string): Promise<void> => {
    if (!window.bonzi || isSavingSettings || !pluginSettings) {
      return
    }

    const installedPlugin = pluginSettings.installedPlugins.find(
      (plugin) => plugin.id === pluginId
    )

    if (!installedPlugin || !installedPlugin.removable) {
      return
    }

    const confirmed =
      approvalSettings?.approvalsEnabled === false ||
      window.confirm(
        `Uninstall plugin "${installedPlugin.name}"? This removes the package from Bonzi workspace dependencies.`
      )

    if (!confirmed) {
      return
    }

    const previousEnabled = installedPlugin.enabled

    isSavingSettings = true
    rerenderPluginSettings()
    setSettingsStatus('Uninstalling plugin…')

    try {
      const uninstallResult = await window.bonzi.plugins.uninstall({
        id: installedPlugin.id,
        pluginId: installedPlugin.id,
        packageName: installedPlugin.packageName,
        confirmed: true
      })

      setSettingsStatus(uninstallResult.message)
      await hydratePluginSettings({ preserveStatus: true })

      if (uninstallResult.ok && previousEnabled) {
        setRuntimeReloadPending(true)
      }
    } catch (error) {
      setSettingsStatus(`Failed to uninstall plugin: ${String(error)}`)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
    }
  }

  minimizeButton.addEventListener('click', () => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.minimize()
  })

  closeButton.addEventListener('click', () => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.close()
  })

  settingsButton.addEventListener('click', () => {
    setUiVisible(true)
    setSettingsVisible(!isSettingsVisible)
  })

  settingsCloseButton.addEventListener('click', () => {
    setSettingsVisible(false)
  })

  applyRuntimeChangesButton.addEventListener('click', async () => {
    if (!window.bonzi || isApplyingRuntimeChanges) {
      return
    }

    isApplyingRuntimeChanges = true
    syncSettingsStatusUi()
    setSettingsStatus('Reloading elizaOS runtime…')

    try {
      await window.bonzi.assistant.reloadRuntime()
      setRuntimeReloadPending(false)
      setSettingsStatus('Runtime reload complete.')
      const nextShellState = await window.bonzi.app.getShellState()
      applyShellState(nextShellState)
    } catch (error) {
      setSettingsStatus(`Runtime reload failed: ${String(error)}`)
    } finally {
      isApplyingRuntimeChanges = false
      syncSettingsStatusUi()
    }
  })

  pluginSettingsEl.addEventListener('change', async (event) => {
    const target = event.target

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const pluginId = target.dataset.pluginToggle

    if (!pluginId || !pluginSettings) {
      return
    }

    const plugin = pluginSettings.installedPlugins.find(
      (candidate) => candidate.id === pluginId
    )

    if (!plugin || plugin.required || (!plugin.configurable && !plugin.removable)) {
      return
    }

    await submitPluginSettingsUpdate(
      {
        operations: [
          {
            type: 'set-enabled',
            id: pluginId,
            enabled: target.checked
          }
        ]
      },
      'Saving plugin settings…'
    )
  })

  approvalSettingsEl.addEventListener('change', async (event) => {
    const target = event.target

    if (!(target instanceof HTMLInputElement) || !target.matches('[data-approval-toggle]')) {
      return
    }

    if (!window.bonzi || isSavingApprovalSettings) {
      target.checked = approvalSettings?.approvalsEnabled !== false
      return
    }

    const approvalsEnabled = target.checked
    const confirmedDisable = approvalsEnabled
      ? true
      : window.confirm(
          'Disable action and workflow approvals? Bonzi will run approved action types automatically when workflows or action cards reach them.'
        )

    if (!confirmedDisable) {
      target.checked = true
      return
    }

    isSavingApprovalSettings = true
    rerenderApprovalSettings()
    setSettingsStatus(
      approvalsEnabled ? 'Enabling approvals…' : 'Disabling approvals…'
    )

    try {
      approvalSettings = await window.bonzi.settings.updateRuntimeApprovalSettings({
        approvalsEnabled,
        ...(approvalsEnabled ? {} : { confirmedDisable: true })
      })

      if (!approvalSettings.approvalsEnabled) {
        pendingConfirmations.clear()
        await autoRunPendingActionCards()
      }

      setSettingsStatus(
        approvalSettings.approvalsEnabled
          ? 'Action approvals enabled.'
          : 'Action approvals disabled. Bonzi has more autonomy now.'
      )
      const nextShellState = await window.bonzi.app.getShellState()
      applyShellState(nextShellState)
      rerenderConversation()
    } catch (error) {
      setSettingsStatus(`Failed to update approval settings: ${String(error)}`)
      await hydrateApprovalSettings()
    } finally {
      isSavingApprovalSettings = false
      rerenderApprovalSettings()
    }
  })

  pluginSettingsEl.addEventListener('click', async (event) => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const installButton = target.closest<HTMLButtonElement>('[data-plugin-install]')
    const uninstallButton = target.closest<HTMLButtonElement>(
      '[data-plugin-uninstall]'
    )
    const addButton = target.closest<HTMLButtonElement>('[data-plugin-add]')
    const removeButton = target.closest<HTMLButtonElement>('[data-plugin-remove]')

    if (installButton?.dataset.pluginInstall) {
      await installDiscoveredPlugin(installButton.dataset.pluginInstall)
      return
    }

    if (uninstallButton?.dataset.pluginUninstall) {
      await uninstallInstalledPlugin(uninstallButton.dataset.pluginUninstall)
      return
    }

    const pluginId = addButton?.dataset.pluginAdd ?? removeButton?.dataset.pluginRemove

    if (!pluginId || !isElizaOptionalPluginId(pluginId)) {
      return
    }

    if (addButton) {
      await submitPluginSettingsUpdate(
        {
          operations: [
            {
              type: 'add',
              id: pluginId
            }
          ]
        },
        'Adding bundled plugin…'
      )
      return
    }

    const plugin = pluginSettings?.installedPlugins.find(
      (candidate) => candidate.id === pluginId
    )

    if (!plugin?.removable) {
      return
    }

    await submitPluginSettingsUpdate(
      {
        operations: [
          {
            type: 'remove',
            id: pluginId
          }
        ]
      },
      'Removing plugin…'
    )
  })

  chatFormEl.addEventListener('submit', async (event) => {
    event.preventDefault()

    if (!window.bonzi) {
      return
    }

    const command = chatInputEl.value.trim()

    if (!command) {
      return
    }

    const userMessage = createMessage('user', command)
    conversation.push({
      message: userMessage,
      actions: [],
      warnings: []
    })
    isAwaitingAssistant = true
    rerenderConversation()

    chatInputEl.value = ''
    setAssistantInputEnabled(false)

    try {
      const response = await window.bonzi.assistant.sendCommand({ command })

      setProviderLabel(response.provider.label)

      if (response.ok && response.reply) {
        addAssistantTurn(conversation, response)

        if (response.workflowRun) {
          const existingWorkflowRun = workflowRunsById.get(response.workflowRun.id)
          const latestWorkflowRun = rememberWorkflowRun(
            existingWorkflowRun && existingWorkflowRun.revision > response.workflowRun.revision
              ? existingWorkflowRun
              : response.workflowRun
          )
          const latestEntry = conversation.at(-1)

          if (latestEntry && !latestEntry.workflowRun) {
            latestEntry.workflowRun = latestWorkflowRun
          } else if (latestEntry?.workflowRun?.id === latestWorkflowRun.id) {
            latestEntry.workflowRun = latestWorkflowRun
          }
        }
      } else {
        appendSystemMessage(
          response.error ??
            'The assistant did not return a reply for this command.'
        )
      }

      isAwaitingAssistant = false
      rerenderConversation()
      setUiVisible(false)
    } catch (error) {
      isAwaitingAssistant = false
      appendSystemMessage(`Assistant request failed: ${String(error)}`)
    } finally {
      isAwaitingAssistant = false
      setAssistantInputEnabled(true)
      if (isUiVisible) {
        chatInputEl.focus()
      }
    }
  })

  chatLogEl.addEventListener('click', async (event) => {
    if (!window.bonzi) {
      return
    }

    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const workflowApprovalButton = target.closest<HTMLButtonElement>(
      '[data-workflow-approve], [data-workflow-decline]'
    )

    if (workflowApprovalButton) {
      const runId = workflowApprovalButton.dataset.workflowRunId
      const stepId = workflowApprovalButton.dataset.workflowStepId
      const approved = workflowApprovalButton.hasAttribute('data-workflow-approve')

      if (!runId || !stepId) {
        return
      }

      const siblingButtons = chatLogEl.querySelectorAll<HTMLButtonElement>(
        '[data-workflow-run-id][data-workflow-step-id]'
      )
      siblingButtons.forEach((button) => {
        if (
          button.dataset.workflowRunId === runId &&
          button.dataset.workflowStepId === stepId
        ) {
          button.disabled = true
        }
      })

      try {
        const response = await window.bonzi.assistant.respondWorkflowApproval({
          runId,
          stepId,
          approved
        })

        if (response.run) {
          if (applyWorkflowRunUpdate(response.run)) {
            rerenderConversation()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow approval failed: ${String(error)}`)
      } finally {
        rerenderConversation()
      }

      return
    }

    const workflowCancelButton = target.closest<HTMLButtonElement>(
      '[data-workflow-cancel]'
    )

    if (workflowCancelButton) {
      const runId = workflowCancelButton.dataset.workflowRunId

      if (!runId) {
        return
      }

      workflowCancelButton.disabled = true

      try {
        const response = await window.bonzi.assistant.cancelWorkflowRun({ runId })

        if (response.run) {
          if (applyWorkflowRunUpdate(response.run)) {
            rerenderConversation()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow cancel failed: ${String(error)}`)
      } finally {
        rerenderConversation()
      }

      return
    }

    const actionButton = target.closest<HTMLButtonElement>('[data-action-id]')

    if (!actionButton) {
      return
    }

    const actionId = actionButton.dataset.actionId

    if (!actionId) {
      return
    }

    const isConfirmed = pendingConfirmations.has(actionId)
    actionButton.disabled = true

    try {
      const response = await window.bonzi.assistant.executeAction({
        actionId,
        confirmed: isConfirmed
      })

      if (response.action) {
        applyActionUpdate(conversation, response.action)
      }

      if (response.confirmationRequired) {
        pendingConfirmations.add(actionId)
      } else {
        pendingConfirmations.delete(actionId)
      }

      appendSystemMessage(response.message)
    } catch (error) {
      appendSystemMessage(`Action failed: ${String(error)}`)
    } finally {
      rerenderConversation()
    }
  })

  stageShellEl.addEventListener('dblclick', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('.speech-bubble')) {
      return
    }

    event.preventDefault()
    setUiVisible(!isUiVisible)
  })

  stageShellEl.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0 || event.detail > 1) {
      return
    }

    if (!window.bonzi) {
      return
    }

    if (
      event.target instanceof HTMLElement &&
      (event.target.closest('.speech-bubble') || event.target.closest('.command-dock'))
    ) {
      return
    }

    const bounds = await window.bonzi.window.getBounds()

    if (!bounds) {
      return
    }

    dragState = {
      pointerId: event.pointerId,
      startBounds: {
        x: bounds.x,
        y: bounds.y
      },
      startScreen: {
        x: event.screenX,
        y: event.screenY
      }
    }

    stageShellEl.setPointerCapture(event.pointerId)
  })

  stageShellEl.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId || !window.bonzi) {
      return
    }

    const deltaX = event.screenX - dragState.startScreen.x
    const deltaY = event.screenY - dragState.startScreen.y

    window.bonzi.window.setPosition(
      dragState.startBounds.x + deltaX,
      dragState.startBounds.y + deltaY
    )
  })

  const clearDragState = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (stageShellEl.hasPointerCapture(event.pointerId)) {
      stageShellEl.releasePointerCapture(event.pointerId)
    }

    dragState = null
  }

  stageShellEl.addEventListener('pointerup', clearDragState)
  stageShellEl.addEventListener('pointercancel', clearDragState)

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSettingsVisible(false)
      setUiVisible(false)
    }
  })

  vrmRetryButton.addEventListener('click', () => {
    void loadVrm()
  })

  if (!window.bonzi) {
    const message = 'Bonzi preload bridge is unavailable. Restart the app after rebuilding.'
    setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    setProviderLabel('Bridge unavailable')
    vrmStatusEl.textContent = 'Renderer blocked'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    settingsButton.disabled = true
    settingsCloseButton.disabled = true
    minimizeButton.disabled = true
    closeButton.disabled = true
    chatInputEl.disabled = true
    assistantSendButton.disabled = true
    appendSystemMessage(message)
    syncBubbleWindowLayout()
    return
  }

  unsubscribeAssistantEvents = window.bonzi.assistant.onEvent(handleAssistantEvent)

  void (async () => {
    const [shellStateResult, historyResult, pluginSettingsResult] =
      await Promise.allSettled([
        window.bonzi.app.getShellState(),
        window.bonzi.assistant.getHistory(),
        discoverPluginSettings()
      ])

    if (shellStateResult.status === 'rejected') {
      const message = `Failed to load shell state: ${String(shellStateResult.reason)}`
      setAppReadyState('error')
      shellStateEl.textContent = message
      vrmPathEl.textContent = 'Unavailable'
      vrmStatusEl.textContent = 'VRM failed to initialize'
      vrmErrorEl.hidden = false
      vrmErrorEl.textContent = message
      vrmRetryButton.hidden = true
      appendSystemMessage(message)
      return
    }

    applyShellState(shellStateResult.value)

    if (historyResult.status === 'fulfilled') {
      hydrateConversation(historyResult.value)
    } else {
      appendSystemMessage(
        `Failed to load assistant history: ${String(historyResult.reason)}`
      )
    }

    if (pluginSettingsResult.status === 'fulfilled') {
      pluginSettings = pluginSettingsResult.value
      rerenderPluginSettings()
    } else {
      setSettingsStatus(
        `Failed to load plugin settings: ${String(pluginSettingsResult.reason)}`
      )
    }

    if (
      conversation.length === 0 &&
      shellStateResult.value.assistant.warnings.length > 0
    ) {
      appendSystemMessage(shellStateResult.value.assistant.warnings.join(' '))
    }

    setAssistantInputEnabled(true)
    setAppReadyState('ready')
    void loadVrm()
  })().catch((error: unknown) => {
    const message = `Failed to hydrate Bonzi shell: ${String(error)}`
    setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    vrmStatusEl.textContent = 'VRM failed to initialize'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    appendSystemMessage(message)
  })

  window.addEventListener(
    'beforeunload',
    () => {
      unsubscribeAssistantEvents?.()
      unsubscribeAssistantEvents = null
      bubbleWindowLayout.dispose()
      vrmStage.dispose()
    },
    { once: true }
  )

  syncBubbleWindowLayout()
}
