import {
  type AssistantRuntimeStatus,
  type RuntimeApprovalSettings,
  type ShellState
} from '../shared/contracts'
import type { MountedAppElements } from './app-dom'
import {
  shellStageForRuntimeStatus,
  shellStateMarkup
} from './app-shell-state'

export type AppReadyState = 'loading' | 'ready' | 'error'

export interface ShellStateController {
  getShellState(): ShellState | null
  setAppReadyState(state: AppReadyState): void
  setProviderLabel(label: string): void
  applyShellState(state: ShellState): ShellState
  syncRuntimeStatus(status: AssistantRuntimeStatus): void
}

export interface ShellStateControllerOptions {
  elements: Pick<
    MountedAppElements,
    | 'shellStateEl'
    | 'shellEl'
    | 'vrmPathEl'
    | 'providerLabelEl'
    | 'providerPillEl'
  >
  onSyncApprovalSettings(settings: RuntimeApprovalSettings): void
}

export function createShellStateController(
  options: ShellStateControllerOptions
): ShellStateController {
  const {
    shellStateEl,
    shellEl,
    vrmPathEl,
    providerLabelEl,
    providerPillEl
  } = options.elements

  let shellState: ShellState | null = null
  let pendingRuntimeStatus: AssistantRuntimeStatus | null = null

  const setAppReadyState = (state: AppReadyState): void => {
    shellEl.dataset.appReady = state
  }

  const setProviderLabel = (label: string): void => {
    providerLabelEl.textContent = label
    providerPillEl.textContent = label
  }

  const applyShellState = (state: ShellState): ShellState => {
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
    options.onSyncApprovalSettings(nextState.assistant.approvals)
    shellStateEl.textContent = shellStateMarkup(nextState)
    vrmPathEl.textContent = nextState.vrmAssetPath
    setProviderLabel(nextState.assistant.provider.label)

    return nextState
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

  return {
    getShellState: () => shellState,
    setAppReadyState,
    setProviderLabel,
    applyShellState,
    syncRuntimeStatus
  }
}
