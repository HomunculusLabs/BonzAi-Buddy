import * as THREE from 'three'
import type { AssistantEventEmoteId } from '../shared/contracts'
import type {
  JellyfishFramePose,
  JellyfishMotionState
} from './jellyfish-types'

const SWIM_BURST_DURATION_SECONDS = 1.18
const DRAG_RELEASE_DURATION_SECONDS = 0.92
const DOUBLE_CLICK_BURST_DURATION_SECONDS = 1.05

export function createJellyfishMotionState(elapsed: number): JellyfishMotionState {
  return {
    activeEmote: null,
    animationElapsed: elapsed,
    doubleClickStartAt: Number.NEGATIVE_INFINITY,
    dragReleaseStartAt: Number.NEGATIVE_INFINITY,
    isDragging: false,
    nextSwimBurstAt: elapsed + 1.4,
    swimBurstStartAt: Number.NEGATIVE_INFINITY
  }
}

export function startJellyfishEmote(
  state: JellyfishMotionState,
  emoteId: AssistantEventEmoteId,
  elapsed: number
): boolean {
  const eventElapsed = getJellyfishEventElapsed(state, elapsed)
  state.activeEmote = {
    duration: emoteId === 'happy-bounce' ? 1.45 : 1.8,
    id: emoteId,
    startAt: eventElapsed
  }
  state.swimBurstStartAt = eventElapsed
  state.nextSwimBurstAt = Math.max(state.nextSwimBurstAt, eventElapsed + 2.2)

  return true
}

export function setJellyfishDragging(
  state: JellyfishMotionState,
  dragging: boolean,
  elapsed: number
): void {
  if (state.isDragging === dragging) {
    return
  }

  const eventElapsed = getJellyfishEventElapsed(state, elapsed)
  state.isDragging = dragging

  if (dragging) {
    state.dragReleaseStartAt = Number.NEGATIVE_INFINITY
    state.swimBurstStartAt = eventElapsed
    state.nextSwimBurstAt = Math.max(state.nextSwimBurstAt, eventElapsed + 1.6)
    return
  }

  state.dragReleaseStartAt = eventElapsed
}

export function startJellyfishDoubleClickBurst(
  state: JellyfishMotionState,
  elapsed: number
): void {
  const eventElapsed = getJellyfishEventElapsed(state, elapsed)
  state.doubleClickStartAt = eventElapsed
  state.swimBurstStartAt = eventElapsed
  state.nextSwimBurstAt = Math.max(state.nextSwimBurstAt, eventElapsed + 2.2)
}

export function evaluateJellyfishFrame(input: {
  state: JellyfishMotionState
  delta: number
  elapsed: number
  pointerNdc: THREE.Vector2
}): JellyfishFramePose {
  const { delta, elapsed, pointerNdc, state } = input
  void delta

  if (elapsed >= state.nextSwimBurstAt) {
    state.swimBurstStartAt = elapsed
    state.nextSwimBurstAt = elapsed + 3.8 + (Math.sin(elapsed * 0.63) + 1) * 1.1
  }

  if (
    state.activeEmote &&
    elapsed >= state.activeEmote.startAt + state.activeEmote.duration
  ) {
    state.activeEmote = null
  }

  const swim = Math.sin(elapsed * 1.55)
  const swimBurst = animationEnvelope(
    elapsed,
    state.swimBurstStartAt,
    SWIM_BURST_DURATION_SECONDS
  )
  const dragRelease = animationEnvelope(
    elapsed,
    state.dragReleaseStartAt,
    DRAG_RELEASE_DURATION_SECONDS
  )
  const doubleClickBurst = animationEnvelope(
    elapsed,
    state.doubleClickStartAt,
    DOUBLE_CLICK_BURST_DURATION_SECONDS
  )
  const dragHold = state.isDragging ? 1 : 0
  const activeEmote = state.activeEmote
  const emoteProgress = activeEmote
    ? THREE.MathUtils.clamp(
        (elapsed - activeEmote.startAt) / activeEmote.duration,
        0,
        1
      )
    : 0
  const emoteEnvelope = activeEmote ? Math.sin(emoteProgress * Math.PI) : 0
  const happyBounce = activeEmote?.id === 'happy-bounce' ? emoteEnvelope : 0
  const waveSway =
    activeEmote?.id === 'wave'
      ? Math.sin(emoteProgress * Math.PI * 3) * emoteEnvelope
      : 0
  const dragWobble = Math.sin(elapsed * 6.2) * (dragHold * 0.42 + dragRelease * 0.28)
  const clickWobble = Math.sin(elapsed * 12) * doubleClickBurst
  const pulse =
    1 +
    swim * 0.02 +
    swimBurst * 0.095 +
    happyBounce * 0.14 +
    dragHold * 0.065 +
    dragRelease * 0.05 +
    doubleClickBurst * 0.18
  const tentacleEnergy =
    1 +
    swimBurst * 0.7 +
    happyBounce * 0.64 +
    Math.abs(waveSway) * 0.72 +
    dragHold * 0.8 +
    dragRelease * 0.58 +
    doubleClickBurst * 0.82
  const driftX =
    pointerNdc.x * 0.036 +
    Math.sin(elapsed * 0.34) * 0.035 +
    waveSway * 0.07 +
    dragWobble * 0.032
  const driftZ =
    Math.cos(elapsed * 0.23) * 0.022 -
    swimBurst * 0.05 +
    dragHold * 0.03 -
    doubleClickBurst * 0.07

  return {
    bellDetailsRotationYVelocity: 0.025 + doubleClickBurst * 0.12,
    bellDetailsScale: new THREE.Vector3(
      1 + swim * 0.018 + swimBurst * 0.035,
      1 + swim * 0.024 + swimBurst * 0.045,
      1 + swim * 0.018 + swimBurst * 0.035
    ),
    bellPivotScale: new THREE.Vector3(pulse, 1 / pulse, pulse),
    coreGlowScale: new THREE.Vector3(
      0.72 + swim * 0.025 + happyBounce * 0.06 + doubleClickBurst * 0.1,
      0.42 + swim * 0.018 + swimBurst * 0.05 + doubleClickBurst * 0.07,
      0.72 + swim * 0.025 + happyBounce * 0.06 + doubleClickBurst * 0.1
    ),
    glowLightIntensity:
      1.1 +
      Math.max(0, swim) * 0.28 +
      swimBurst * 0.58 +
      happyBounce * 0.8 +
      dragHold * 0.42 +
      dragRelease * 0.28 +
      doubleClickBurst * 1.35,
    oralGlowScale: new THREE.Vector3(
      0.46 + swim * 0.02 + happyBounce * 0.04 + doubleClickBurst * 0.08,
      0.68 + swimBurst * 0.06 + doubleClickBurst * 0.06,
      0.36 + swim * 0.018 + happyBounce * 0.04
    ),
    rootPosition: new THREE.Vector3(
      driftX,
      0.92 +
        Math.sin(elapsed * 0.54) * 0.045 +
        swimBurst * 0.1 +
        happyBounce * 0.22 +
        dragRelease * 0.045 +
        doubleClickBurst * 0.16,
      driftZ
    ),
    rootRotationYVelocity:
      0.14 + swimBurst * 0.28 + happyBounce * 0.22 + doubleClickBurst * 3.3,
    rootRotationZ:
      -pointerNdc.x * 0.045 + Math.sin(elapsed * 0.41) * 0.04 + waveSway * 0.18 + dragWobble * 0.13 + clickWobble * 0.05,
    rootScale: new THREE.Vector3(
      1 + dragHold * 0.04 + dragRelease * 0.025 + doubleClickBurst * 0.07,
      1 - dragHold * 0.065 + dragRelease * 0.035 + doubleClickBurst * 0.09,
      1 + dragHold * 0.04 + dragRelease * 0.025 + doubleClickBurst * 0.07
    ),
    skirtScale: new THREE.Vector3(
      1 + swim * 0.03 + swimBurst * 0.06 + doubleClickBurst * 0.1,
      1,
      1 + swim * 0.03 + swimBurst * 0.06 + doubleClickBurst * 0.1
    ),
    tentacleEnergy,
    tentacleWaveSway: waveSway + dragWobble * 0.3 + clickWobble * 0.12
  }
}

function getJellyfishEventElapsed(state: JellyfishMotionState, fallbackElapsed: number): number {
  return Number.isFinite(state.animationElapsed) ? state.animationElapsed : fallbackElapsed
}

function animationEnvelope(elapsed: number, startAt: number, duration: number): number {
  if (!Number.isFinite(startAt)) {
    return 0
  }

  const progress = THREE.MathUtils.clamp((elapsed - startAt) / duration, 0, 1)

  if (progress <= 0 || progress >= 1) {
    return 0
  }

  return Math.sin(progress * Math.PI)
}
