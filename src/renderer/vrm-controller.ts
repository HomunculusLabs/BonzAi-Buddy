import type { AssistantEventEmoteId } from '../shared/contracts'
import type { MountedAppElements } from './app-dom'
import { createVrmStage, type VrmStageController } from './vrm-stage'

export interface VrmController {
  hasError(): boolean
  hitTestClientPoint(clientX: number, clientY: number): boolean | null
  load(assetPath: string | null | undefined): Promise<void>
  playOrQueueEmote(emoteId: AssistantEventEmoteId): void
  dispose(): void
}

export interface VrmControllerOptions {
  disableVrm: boolean
  elements: Pick<
    MountedAppElements,
    'vrmCanvas' | 'vrmStatusEl' | 'vrmErrorEl' | 'vrmRetryButton'
  >
  onErrorVisibilityChange(): void
}

export function createVrmController(options: VrmControllerOptions): VrmController {
  const { disableVrm } = options
  const { vrmCanvas, vrmStatusEl, vrmErrorEl, vrmRetryButton } = options.elements
  let pendingStageEmote: AssistantEventEmoteId | null = null

  const setErrorMessage = (message: string | null): void => {
    if (!message) {
      vrmErrorEl.hidden = true
      vrmErrorEl.textContent = ''
      vrmRetryButton.hidden = true
      options.onErrorVisibilityChange()
      return
    }

    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = `VRM load error: ${message}`
    vrmRetryButton.hidden = false
    options.onErrorVisibilityChange()
  }

  const vrmStage: VrmStageController = disableVrm
    ? {
        dispose: () => {},
        hitTestClientPoint: () => null,
        load: async () => {
          vrmStatusEl.textContent = 'VRM disabled for automated tests'
          setErrorMessage(null)
        },
        playBuiltInEmote: () => false
      }
    : createVrmStage(vrmCanvas, {
        onStatusChange: (message) => {
          vrmStatusEl.textContent = message
        },
        onErrorChange: setErrorMessage
      })

  if (disableVrm) {
    vrmStatusEl.textContent = 'VRM disabled for automated tests'
    setErrorMessage(null)
  }

  const flushPendingStageEmote = (): void => {
    if (!pendingStageEmote) {
      return
    }

    if (vrmStage.playBuiltInEmote(pendingStageEmote)) {
      pendingStageEmote = null
    }
  }

  const load = async (assetPath: string | null | undefined): Promise<void> => {
    if (!assetPath) {
      return
    }

    try {
      await vrmStage.load(assetPath)

      if (!disableVrm) {
        flushPendingStageEmote()
      }
    } catch {
      // UI/error state is already updated inside the stage controller.
    }
  }

  const playOrQueueEmote = (emoteId: AssistantEventEmoteId): void => {
    if (disableVrm) {
      return
    }

    if (vrmStage.playBuiltInEmote(emoteId)) {
      pendingStageEmote = null
      return
    }

    pendingStageEmote = emoteId
  }

  return {
    hasError: () => !vrmErrorEl.hidden,
    hitTestClientPoint: vrmStage.hitTestClientPoint,
    load,
    playOrQueueEmote,
    dispose: vrmStage.dispose
  }
}
