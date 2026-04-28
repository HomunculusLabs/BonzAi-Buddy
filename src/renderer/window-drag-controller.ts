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

export interface WindowDragController {
  dispose(): void
}

function areFiniteWindowCoordinates(...values: number[]): boolean {
  return values.every(Number.isFinite)
}

export function createWindowDragController(options: {
  canStartDrag?: (event: PointerEvent) => boolean
  onDragStateChange?: (dragging: boolean) => void
  stageShellEl: HTMLElement
}): WindowDragController {
  const { canStartDrag, onDragStateChange, stageShellEl } = options
  let dragState: WindowDragState | null = null

  const handlePointerDown = async (event: PointerEvent): Promise<void> => {
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

    if (canStartDrag && !canStartDrag(event)) {
      return
    }

    const bounds = await window.bonzi.window.getBounds()

    if (!bounds || !areFiniteWindowCoordinates(bounds.x, bounds.y)) {
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
    onDragStateChange?.(true)
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId || !window.bonzi) {
      return
    }

    const deltaX = event.screenX - dragState.startScreen.x
    const deltaY = event.screenY - dragState.startScreen.y
    const nextX = dragState.startBounds.x + deltaX
    const nextY = dragState.startBounds.y + deltaY

    if (!areFiniteWindowCoordinates(nextX, nextY)) {
      return
    }

    window.bonzi.window.setPosition(nextX, nextY)
  }

  const clearDragState = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (stageShellEl.hasPointerCapture(event.pointerId)) {
      stageShellEl.releasePointerCapture(event.pointerId)
    }

    dragState = null
    onDragStateChange?.(false)
  }

  stageShellEl.addEventListener('pointerdown', handlePointerDown)
  stageShellEl.addEventListener('pointermove', handlePointerMove)
  stageShellEl.addEventListener('pointerup', clearDragState)
  stageShellEl.addEventListener('pointercancel', clearDragState)

  return {
    dispose: () => {
      if (dragState) {
        onDragStateChange?.(false)
        dragState = null
      }

      stageShellEl.removeEventListener('pointerdown', handlePointerDown)
      stageShellEl.removeEventListener('pointermove', handlePointerMove)
      stageShellEl.removeEventListener('pointerup', clearDragState)
      stageShellEl.removeEventListener('pointercancel', clearDragState)
    }
  }
}
