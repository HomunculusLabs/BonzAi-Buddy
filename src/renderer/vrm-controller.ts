import type { AssistantEventEmoteId } from '../shared/contracts'
import type { MountedAppElements } from './app-dom'
import {
  createVrmStage,
  type VrmStageBuddyKind,
  type VrmStageController
} from './vrm-stage'

export type BuddyKind = VrmStageBuddyKind

export interface VrmController {
  hasError(): boolean
  hitTestClientPoint(clientX: number, clientY: number): boolean | null
  load(assetPath: string | null | undefined, buddyKind?: BuddyKind): Promise<void>
  playDoubleClickAnimation(): void
  playOrQueueEmote(emoteId: AssistantEventEmoteId): void
  setDragging(dragging: boolean): void
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
  let currentBuddyKind: BuddyKind = 'bonzi'

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
        clear: () => {},
        dispose: () => {},
        hitTestClientPoint: () => null,
        load: async () => {
          vrmStatusEl.textContent = 'Character renderer disabled for automated tests'
          setErrorMessage(null)
        },
        playBuiltInEmote: () => false,
        playDoubleClickAnimation: () => false,
        setDragging: () => {}
      }
    : createVrmStage(vrmCanvas, {
        onStatusChange: (message) => {
          vrmStatusEl.textContent = message
        },
        onErrorChange: setErrorMessage
      })

  if (disableVrm) {
    vrmStatusEl.textContent = 'Character renderer disabled for automated tests'
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

  const load = async (
    assetPath: string | null | undefined,
    buddyKind: BuddyKind = currentBuddyKind
  ): Promise<void> => {
    const previousBuddyKind = currentBuddyKind
    currentBuddyKind = buddyKind

    if (buddyKind !== 'bonzi' || previousBuddyKind !== buddyKind) {
      pendingStageEmote = null
    }

    if (!assetPath && buddyKind === 'bonzi') {
      vrmStage.clear()
      vrmStatusEl.textContent = 'Bonzi asset path unavailable'
      setErrorMessage('Bonzi asset path unavailable.')
      return
    }

    try {
      await vrmStage.load(assetPath ?? '', buddyKind)

      if (!disableVrm && buddyKind === 'bonzi') {
        flushPendingStageEmote()
      }
    } catch {
      // UI/error state is already updated inside the stage controller.
    }
  }

  const playDoubleClickAnimation = (): void => {
    if (disableVrm) {
      return
    }

    vrmStage.playDoubleClickAnimation()
  }

  const setDragging = (dragging: boolean): void => {
    if (disableVrm) {
      return
    }

    vrmStage.setDragging(dragging)
  }

  const playOrQueueEmote = (emoteId: AssistantEventEmoteId): void => {
    if (disableVrm) {
      return
    }

    if (vrmStage.playBuiltInEmote(emoteId)) {
      pendingStageEmote = null
      return
    }

    if (currentBuddyKind === 'bonzi') {
      pendingStageEmote = emoteId
    }
  }

  return {
    hasError: () => !vrmErrorEl.hidden,
    hitTestClientPoint: vrmStage.hitTestClientPoint,
    load,
    playDoubleClickAnimation,
    playOrQueueEmote,
    setDragging,
    dispose: vrmStage.dispose
  }
}
