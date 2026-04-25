import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import type { AssistantEventEmoteId } from '../shared/contracts'
import { resolveStageAnimationSet, type ResolvedStageAnimationSet } from './vrma-animation-resolver'
import {
  attachVrmAvatar,
  disposeUnusedVrmScene,
  disposeVrmAvatar,
  refreshVrmAvatarBaseline,
  type VrmAvatarHandle
} from './vrm-stage-avatar'
import {
  createVrmStageAnimationController,
  type VrmStageAnimationController
} from './vrm-stage-animation'
import { createVrmStageScene } from './vrm-stage-scene'

interface VrmStageCallbacks {
  onStatusChange?: (message: string) => void
  onErrorChange?: (message: string | null) => void
}

export interface VrmStageController {
  dispose: () => void
  load: (assetPath: string) => Promise<void>
  playBuiltInEmote: (emoteId: AssistantEventEmoteId) => boolean
}

export function createVrmStage(
  canvas: HTMLCanvasElement,
  callbacks: VrmStageCallbacks = {}
): VrmStageController {
  const stageScene = createVrmStageScene(canvas)
  const loader = new GLTFLoader()
  const clock = new THREE.Clock()

  let animationFrameId = 0
  let activeLoadId = 0
  let animationTimeSeconds = 0
  let disposed = false
  let currentAnimation: VrmStageAnimationController | null = null
  let currentAvatar: VrmAvatarHandle | null = null

  loader.register((parser) => new VRMLoaderPlugin(parser))
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

  startAnimationLoop()

  return {
    dispose,
    load,
    playBuiltInEmote
  }

  async function load(assetPath: string): Promise<void> {
    const loadId = ++activeLoadId

    callbacks.onErrorChange?.(null)
    callbacks.onStatusChange?.('Loading VRM… 0%')

    clearCurrentVrm()

    try {
      const gltf = await loader.loadAsync(assetPath, (event) => {
        if (disposed || loadId !== activeLoadId) {
          return
        }

        if (event.total > 0) {
          const percent = Math.max(
            0,
            Math.min(100, Math.round((event.loaded / event.total) * 100))
          )
          callbacks.onStatusChange?.(`Loading VRM… ${percent}%`)
          return
        }

        const loadedMb = (event.loaded / (1024 * 1024)).toFixed(1)
        callbacks.onStatusChange?.(`Loading VRM… ${loadedMb} MB`)
      })

      if (disposed || loadId !== activeLoadId) {
        disposeUnusedVrmScene(gltf.scene)
        return
      }

      const vrm = (gltf.userData as { vrm?: VRM }).vrm

      if (!vrm) {
        throw new Error('The loaded asset did not expose a VRM instance.')
      }

      callbacks.onStatusChange?.('VRM model ready — loading animation assets…')
      const resolvedAnimationSet = await resolveStageAnimationSet(loader, vrm)

      if (disposed || loadId !== activeLoadId) {
        disposeUnusedVrmScene(vrm.scene)
        return
      }

      finalizeLoadedVrm(vrm, resolvedAnimationSet)
      callbacks.onStatusChange?.(currentAnimation?.statusMessage ?? 'VRM ready')
    } catch (error) {
      if (disposed || loadId !== activeLoadId) {
        return
      }

      clearCurrentVrm()

      const message =
        error instanceof Error ? error.message : 'Unknown VRM loading failure.'

      console.error('Failed to load VRM asset.', error)
      callbacks.onErrorChange?.(message)
      callbacks.onStatusChange?.('VRM failed to load')
      throw error
    }
  }

  function finalizeLoadedVrm(
    vrm: VRM,
    resolvedAnimationSet: ResolvedStageAnimationSet
  ): void {
    currentAvatar = attachVrmAvatar({
      hasLookAtTracks: resolvedAnimationSet.hasLookAtTracks,
      pointerTarget: stageScene.pointerTarget,
      scene: stageScene.scene,
      vrm
    })
    currentAnimation = createVrmStageAnimationController(
      vrm,
      resolvedAnimationSet,
      animationTimeSeconds
    )
    currentAnimation.update({
      basis: animationBasisFor(currentAvatar),
      delta: 0,
      elapsed: animationTimeSeconds,
      pointerNdc: stageScene.pointerNdc,
      vrm
    })
    vrm.update(0)
    refreshVrmAvatarBaseline(currentAvatar)

    stageScene.frameSubject(currentAvatar.metrics)
  }

  function startAnimationLoop(): void {
    const tick = (): void => {
      if (disposed) {
        return
      }

      animationFrameId = window.requestAnimationFrame(tick)

      const delta = Math.min(clock.getDelta(), 1 / 20)
      animationTimeSeconds += delta

      stageScene.updatePointerTarget(delta)

      if (currentAvatar && currentAnimation) {
        currentAnimation.update({
          basis: animationBasisFor(currentAvatar),
          delta,
          elapsed: animationTimeSeconds,
          pointerNdc: stageScene.pointerNdc,
          vrm: currentAvatar.vrm
        })
        currentAvatar.vrm.update(delta)
      }

      stageScene.render()
    }

    tick()
  }

  function playBuiltInEmote(emoteId: AssistantEventEmoteId): boolean {
    if (disposed || !currentAnimation || !currentAvatar) {
      return false
    }

    return currentAnimation.playBuiltInEmote(emoteId, animationTimeSeconds)
  }

  function clearCurrentVrm(): void {
    if (currentAnimation && currentAvatar) {
      currentAnimation.dispose(currentAvatar.vrm.scene)
    }

    currentAnimation = null

    if (!currentAvatar) {
      stageScene.frameSubject(null)
      return
    }

    disposeVrmAvatar(stageScene.scene, currentAvatar)
    currentAvatar = null
    stageScene.frameSubject(null)
  }

  function animationBasisFor(avatar: VrmAvatarHandle): {
    rootBasePosition: THREE.Vector3
    rootBaseRotation: THREE.Euler
    rootHeight: number
  } {
    return {
      rootBasePosition: avatar.rootBasePosition,
      rootBaseRotation: avatar.rootBaseRotation,
      rootHeight: avatar.metrics.rootHeight
    }
  }

  function dispose(): void {
    disposed = true

    window.cancelAnimationFrame(animationFrameId)
    clearCurrentVrm()
    stageScene.dispose()
  }
}
