import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { AssistantEventEmoteId } from '../shared/contracts'
import type { ResolvedStageAnimationSet } from './vrma-animation-resolver'

interface EmoteActionState {
  action: THREE.AnimationAction
  duration: number
  name: string
}

type AnimationPhase = 'idle' | 'emote' | 'returning'

interface VrmAnimationState {
  activeEmote: EmoteActionState | null
  emotes: EmoteActionState[]
  idleAction: THREE.AnimationAction
  lastEmoteName: string | null
  mixer: THREE.AnimationMixer
  nextEmoteAt: number
  phase: AnimationPhase
  returnAt: number
  returnEndAt: number
  statusMessage: string
}

export interface CursorReactionBasis {
  rootBasePosition: THREE.Vector3
  rootBaseRotation: THREE.Euler
  rootHeight: number
}

export interface VrmStageAnimationController {
  statusMessage: string
  dispose: (root: THREE.Object3D) => void
  playBuiltInEmote: (emoteId: AssistantEventEmoteId, elapsed: number) => boolean
  update: (options: {
    basis: CursorReactionBasis
    delta: number
    elapsed: number
    pointerNdc: THREE.Vector2
    vrm: VRM
  }) => void
}

const EMOTE_FADE_SECONDS = 0.85
const MIN_EMOTE_INTERVAL_SECONDS = 8
const MAX_EMOTE_INTERVAL_SECONDS = 14

export function createVrmStageAnimationController(
  vrm: VRM,
  resolvedAnimationSet: ResolvedStageAnimationSet,
  elapsed: number
): VrmStageAnimationController {
  const state = createAnimationState(vrm, resolvedAnimationSet, elapsed)

  return {
    statusMessage: state.statusMessage,
    dispose,
    playBuiltInEmote,
    update
  }

  function update(options: {
    basis: CursorReactionBasis
    delta: number
    elapsed: number
    pointerNdc: THREE.Vector2
    vrm: VRM
  }): void {
    updateAnimationState(state, options.elapsed)
    state.mixer.update(options.delta)
    applyCursorReaction(options.vrm, options.pointerNdc, options.basis, options.delta)
  }

  function playBuiltInEmote(
    emoteId: AssistantEventEmoteId,
    elapsedAtStart: number
  ): boolean {
    const emote = state.emotes.find((candidate) => candidate.name === emoteId)

    if (!emote) {
      return false
    }

    startEmote(state, emote, elapsedAtStart)
    return true
  }

  function dispose(root: THREE.Object3D): void {
    state.mixer.stopAllAction()
    state.mixer.uncacheRoot(root)
  }
}

function createAnimationState(
  vrm: VRM,
  resolvedAnimationSet: ResolvedStageAnimationSet,
  elapsed: number
): VrmAnimationState {
  const mixer = new THREE.AnimationMixer(vrm.scene)
  const idleAction = mixer.clipAction(resolvedAnimationSet.idle)

  idleAction.enabled = true
  idleAction.setLoop(THREE.LoopRepeat, Infinity)
  idleAction.play()

  const emotes = resolvedAnimationSet.emotes.map((clip) => {
    const action = mixer.clipAction(clip)
    action.enabled = false
    action.clampWhenFinished = true
    action.setLoop(THREE.LoopOnce, 1)

    if (clip.name.includes('wave')) {
      action.timeScale = 0.82
    }

    return {
      action,
      duration: clip.duration / action.timeScale,
      name: clip.name
    }
  })

  return {
    activeEmote: null,
    emotes,
    idleAction,
    lastEmoteName: null,
    mixer,
    nextEmoteAt: scheduleNextEmoteAt(elapsed),
    phase: 'idle',
    returnAt: Number.POSITIVE_INFINITY,
    returnEndAt: Number.POSITIVE_INFINITY,
    statusMessage: resolvedAnimationSet.statusMessage
  }
}

function updateAnimationState(
  animationState: VrmAnimationState,
  elapsed: number
): void {
  if (animationState.phase === 'idle' && elapsed >= animationState.nextEmoteAt) {
    startRandomEmote(animationState, elapsed)
    return
  }

  if (
    animationState.phase === 'emote' &&
    animationState.activeEmote &&
    elapsed >= animationState.returnAt
  ) {
    beginReturnToIdle(animationState, elapsed)
    return
  }

  if (
    animationState.phase === 'returning' &&
    animationState.activeEmote &&
    elapsed >= animationState.returnEndAt
  ) {
    finishReturningEmote(animationState, elapsed)
  }
}

function startRandomEmote(animationState: VrmAnimationState, elapsed: number): void {
  const emote = pickNextEmote(animationState)

  if (!emote) {
    animationState.nextEmoteAt = scheduleNextEmoteAt(elapsed)
    return
  }

  startEmote(animationState, emote, elapsed)
}

function startEmote(
  animationState: VrmAnimationState,
  emote: EmoteActionState,
  elapsed: number
): void {
  animationState.activeEmote?.action.stop()
  emote.action.stop()
  emote.action.reset()
  emote.action.enabled = true
  emote.action.clampWhenFinished = true
  emote.action.setLoop(THREE.LoopOnce, 1)
  emote.action.play()

  animationState.idleAction.enabled = true
  animationState.idleAction.play()
  animationState.idleAction.crossFadeTo(emote.action, EMOTE_FADE_SECONDS, false)

  animationState.activeEmote = emote
  animationState.lastEmoteName = emote.name
  animationState.phase = 'emote'
  animationState.returnAt =
    elapsed + Math.max(emote.duration * 0.55, emote.duration - EMOTE_FADE_SECONDS - 0.05)
  animationState.returnEndAt = Number.POSITIVE_INFINITY
  animationState.nextEmoteAt = Number.POSITIVE_INFINITY
}

function beginReturnToIdle(animationState: VrmAnimationState, elapsed: number): void {
  const activeEmote = animationState.activeEmote

  if (!activeEmote) {
    animationState.phase = 'idle'
    animationState.returnAt = Number.POSITIVE_INFINITY
    animationState.nextEmoteAt = scheduleNextEmoteAt(elapsed)
    return
  }

  animationState.idleAction.enabled = true
  animationState.idleAction.play()
  activeEmote.action.crossFadeTo(animationState.idleAction, EMOTE_FADE_SECONDS, false)

  animationState.phase = 'returning'
  animationState.returnAt = Number.POSITIVE_INFINITY
  animationState.returnEndAt = elapsed + EMOTE_FADE_SECONDS
}

function finishReturningEmote(animationState: VrmAnimationState, elapsed: number): void {
  animationState.activeEmote?.action.stop()
  animationState.activeEmote = null
  animationState.phase = 'idle'
  animationState.returnAt = Number.POSITIVE_INFINITY
  animationState.returnEndAt = Number.POSITIVE_INFINITY
  animationState.nextEmoteAt = scheduleNextEmoteAt(elapsed)
}

function pickNextEmote(animationState: VrmAnimationState): EmoteActionState | null {
  if (animationState.emotes.length === 0) {
    return null
  }

  const candidates = animationState.emotes.filter(
    (emote) =>
      animationState.emotes.length === 1 || emote.name !== animationState.lastEmoteName
  )
  const pool = candidates.length > 0 ? candidates : animationState.emotes
  const index = Math.floor(Math.random() * pool.length)

  return pool[index] ?? null
}

function scheduleNextEmoteAt(elapsed: number): number {
  return (
    elapsed +
    THREE.MathUtils.randFloat(
      MIN_EMOTE_INTERVAL_SECONDS,
      MAX_EMOTE_INTERVAL_SECONDS
    )
  )
}

function applyCursorReaction(
  vrm: VRM,
  pointerNdc: THREE.Vector2,
  basis: CursorReactionBasis,
  delta: number
): void {
  const positionLerp = 1 - Math.exp(-delta * 8)
  const rotationLerp = 1 - Math.exp(-delta * 9)
  const targetX = basis.rootBasePosition.x + pointerNdc.x * basis.rootHeight * 0.025
  const targetY = basis.rootBasePosition.y + pointerNdc.y * basis.rootHeight * 0.01
  const targetRotX = basis.rootBaseRotation.x + pointerNdc.y * 0.035
  const targetRotY = basis.rootBaseRotation.y + pointerNdc.x * 0.07
  const targetRotZ = basis.rootBaseRotation.z - pointerNdc.x * 0.02

  vrm.scene.position.x = THREE.MathUtils.lerp(vrm.scene.position.x, targetX, positionLerp)
  vrm.scene.position.y = THREE.MathUtils.lerp(vrm.scene.position.y, targetY, positionLerp)
  vrm.scene.rotation.x = THREE.MathUtils.lerp(vrm.scene.rotation.x, targetRotX, rotationLerp)
  vrm.scene.rotation.y = THREE.MathUtils.lerp(vrm.scene.rotation.y, targetRotY, rotationLerp)
  vrm.scene.rotation.z = THREE.MathUtils.lerp(vrm.scene.rotation.z, targetRotZ, rotationLerp)
}
