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
import { createJellyfishBuddy, type JellyfishBuddyHandle } from './jellyfish-buddy'
import { createVrmStageScene } from './vrm-stage-scene'

export type VrmStageBuddyKind = 'bonzi' | 'jellyfish'

interface VrmStageCallbacks {
  onStatusChange?: (message: string) => void
  onErrorChange?: (message: string | null) => void
}

export interface VrmStageController {
  dispose: () => void
  hitTestClientPoint: (clientX: number, clientY: number) => boolean | null
  clear: () => void
  load: (assetPath: string, buddyKind?: VrmStageBuddyKind) => Promise<void>
  playBuiltInEmote: (emoteId: AssistantEventEmoteId) => boolean
}

export function createVrmStage(
  canvas: HTMLCanvasElement,
  callbacks: VrmStageCallbacks = {}
): VrmStageController {
  const stageScene = createVrmStageScene(canvas)
  const loader = new GLTFLoader()
  const clock = new THREE.Clock()
  const raycaster = new THREE.Raycaster()
  raycaster.params.Line = { threshold: 0.045 }
  const hitTestPointer = new THREE.Vector2()

  let animationFrameId = 0
  let activeLoadId = 0
  let animationTimeSeconds = 0
  let disposed = false
  let currentAnimation: VrmStageAnimationController | null = null
  let currentAvatar: VrmAvatarHandle | null = null
  let currentJellyfish: JellyfishBuddyHandle | null = null

  loader.register((parser) => new VRMLoaderPlugin(parser))
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

  startAnimationLoop()

  return {
    clear: clearCurrentSubject,
    dispose,
    hitTestClientPoint,
    load,
    playBuiltInEmote
  }

  async function load(
    assetPath: string,
    buddyKind: VrmStageBuddyKind = 'bonzi'
  ): Promise<void> {
    const loadId = ++activeLoadId

    callbacks.onErrorChange?.(null)

    if (buddyKind === 'jellyfish') {
      try {
        callbacks.onStatusChange?.('Summoning jellyfish buddy…')
        clearCurrentSubject()
        currentJellyfish = createJellyfishBuddy(stageScene.scene)
        stageScene.frameSubject(currentJellyfish.metrics)
        callbacks.onStatusChange?.('Jellyfish buddy ready')
      } catch (error) {
        if (disposed || loadId !== activeLoadId) {
          return
        }

        clearCurrentSubject()

        const message =
          error instanceof Error ? error.message : 'Unknown jellyfish loading failure.'

        console.error('Failed to load jellyfish buddy.', error)
        callbacks.onErrorChange?.(message)
        callbacks.onStatusChange?.('Jellyfish buddy failed to load')
        throw error
      }

      return
    }

    callbacks.onStatusChange?.('Loading VRM… 0%')

    clearCurrentSubject()

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

      clearCurrentSubject()

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

      currentJellyfish?.update(delta, animationTimeSeconds, stageScene.pointerNdc)

      stageScene.render()
    }

    tick()
  }

  function hitTestClientPoint(clientX: number, clientY: number): boolean | null {
    const hitTestRoot = currentAvatar?.vrm.scene ?? currentJellyfish?.root ?? null

    if (disposed || !hitTestRoot) {
      return null
    }

    const rect = canvas.getBoundingClientRect()

    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }

    hitTestPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    )
    raycaster.setFromCamera(hitTestPointer, stageScene.camera)

    return raycaster
      .intersectObject(hitTestRoot, true)
      .some((intersection) =>
        isVisibleHitTestIntersection(intersection, hitTestRoot)
      )
  }

  function playBuiltInEmote(emoteId: AssistantEventEmoteId): boolean {
    if (disposed || !currentAnimation || !currentAvatar) {
      return false
    }

    return currentAnimation.playBuiltInEmote(emoteId, animationTimeSeconds)
  }

  function clearCurrentSubject(): void {
    if (currentAnimation && currentAvatar) {
      currentAnimation.dispose(currentAvatar.vrm.scene)
    }

    currentAnimation = null

    if (currentAvatar) {
      disposeVrmAvatar(stageScene.scene, currentAvatar)
      currentAvatar = null
    }

    if (currentJellyfish) {
      currentJellyfish.dispose()
      currentJellyfish = null
    }

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
    clearCurrentSubject()
    stageScene.dispose()
  }
}

function isVisibleHitTestIntersection(
  intersection: THREE.Intersection,
  root: THREE.Object3D
): boolean {
  if (!isObjectHierarchyVisible(intersection.object, root)) {
    return false
  }

  const maybeMesh = intersection.object as THREE.Object3D & {
    material?: THREE.Material | THREE.Material[]
  }

  if (!maybeMesh.material) {
    return true
  }

  if (!Array.isArray(maybeMesh.material)) {
    return isVisibleHitTestMaterial(maybeMesh.material)
  }

  const materialIndex = intersection.face?.materialIndex
  const hitMaterial =
    typeof materialIndex === 'number' ? maybeMesh.material[materialIndex] : null

  if (hitMaterial) {
    return isVisibleHitTestMaterial(hitMaterial)
  }

  return maybeMesh.material.some(isVisibleHitTestMaterial)
}

function isObjectHierarchyVisible(
  object: THREE.Object3D,
  root: THREE.Object3D
): boolean {
  let current: THREE.Object3D | null = object

  while (current) {
    if (!current.visible) {
      return false
    }

    if (current === root) {
      return true
    }

    current = current.parent
  }

  return false
}

function isVisibleHitTestMaterial(material: THREE.Material): boolean {
  return material.visible && material.opacity > 0.02 && material.colorWrite !== false
}
