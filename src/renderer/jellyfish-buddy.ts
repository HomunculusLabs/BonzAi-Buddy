import * as THREE from 'three'
import type { AssistantEventEmoteId } from '../shared/contracts'
import { composeJellyfishBuddy } from './jellyfish-composition'
import { hitTestJellyfish } from './jellyfish-hit-test'
import {
  createJellyfishMotionState,
  evaluateJellyfishFrame,
  setJellyfishDragging,
  startJellyfishDoubleClickBurst,
  startJellyfishEmote
} from './jellyfish-motion'
import { updateJellyfishTentacles } from './jellyfish-tentacles'
export type {
  JellyfishEmoteState,
  JellyfishFramePose,
  JellyfishMotionState
} from './jellyfish-types'
import { MIN_SUBJECT_HEIGHT, type VrmSubjectMetrics } from './vrm-stage-scene'

export interface JellyfishBuddyHandle {
  metrics: VrmSubjectMetrics
  root: THREE.Group
  playBuiltInEmote(emoteId: AssistantEventEmoteId, elapsed: number): boolean
  playDoubleClickAnimation(elapsed: number): boolean
  setDragging(dragging: boolean, elapsed: number): void
  hitTest(raycaster: THREE.Raycaster): boolean
  update(
    delta: number,
    elapsed: number,
    pointerNdc: THREE.Vector2,
    cameraWorldPosition: THREE.Vector3
  ): void
  dispose(): void
}

export {
  createJellyfishMotionState,
  evaluateJellyfishFrame,
  setJellyfishDragging,
  startJellyfishDoubleClickBurst,
  startJellyfishEmote
}

export function createJellyfishBuddy(scene: THREE.Scene): JellyfishBuddyHandle {
  const {
    bellDetailsRoot,
    bellPivot,
    coreGlow,
    glowLight,
    innerBell,
    oralGlow,
    root,
    skirt,
    tentacles
  } = composeJellyfishBuddy()

  const metrics: VrmSubjectMetrics = {
    center: new THREE.Vector3(0, 0.38, 0),
    rootHeight: Math.max(1.95, MIN_SUBJECT_HEIGHT),
    size: new THREE.Vector3(1.36, 2.02, 1.18)
  }

  scene.add(root)

  const motionState = createJellyfishMotionState(0)
  const cameraLocalPosition = new THREE.Vector3()

  const update = (
    delta: number,
    elapsed: number,
    pointerNdc: THREE.Vector2,
    cameraWorldPosition: THREE.Vector3
  ): void => {
    motionState.animationElapsed = Math.min(
      elapsed,
      motionState.animationElapsed + Math.min(delta, 1 / 30)
    )
    const visualElapsed = motionState.animationElapsed
    const pose = evaluateJellyfishFrame({
      delta,
      elapsed: visualElapsed,
      pointerNdc,
      state: motionState
    })

    root.position.x = THREE.MathUtils.lerp(root.position.x, pose.rootPosition.x, 1 - Math.exp(-delta * 2.6))
    root.position.y = pose.rootPosition.y
    root.position.z = THREE.MathUtils.lerp(root.position.z, pose.rootPosition.z, 1 - Math.exp(-delta * 2.2))
    root.rotation.y += delta * pose.rootRotationYVelocity
    root.rotation.z = THREE.MathUtils.lerp(
      root.rotation.z,
      pose.rootRotationZ,
      1 - Math.exp(-delta * 3.5)
    )
    root.scale.copy(pose.rootScale)

    bellPivot.scale.copy(pose.bellPivotScale)
    innerBell.scale.set(
      0.74 * pose.bellDetailsScale.x,
      0.58 * pose.bellDetailsScale.y,
      0.74 * pose.bellDetailsScale.z
    )
    skirt.scale.copy(pose.skirtScale)
    bellDetailsRoot.scale.copy(pose.bellDetailsScale)
    bellDetailsRoot.rotation.y += delta * pose.bellDetailsRotationYVelocity
    oralGlow.scale.copy(pose.oralGlowScale)
    coreGlow.scale.copy(pose.coreGlowScale)
    glowLight.intensity = pose.glowLightIntensity

    root.updateMatrixWorld(true)
    cameraLocalPosition.copy(cameraWorldPosition)
    root.worldToLocal(cameraLocalPosition)

    updateJellyfishTentacles(
      tentacles,
      visualElapsed,
      pose.bellPivotScale.y,
      pose.tentacleEnergy,
      pose.tentacleWaveSway,
      cameraLocalPosition
    )
  }

  update(0, 0, new THREE.Vector2(), new THREE.Vector3(0, 1.2, 4.2))

  return {
    metrics,
    root,
    playBuiltInEmote: (emoteId, elapsed) =>
      startJellyfishEmote(motionState, emoteId, elapsed),
    playDoubleClickAnimation: (elapsed) => {
      startJellyfishDoubleClickBurst(motionState, elapsed)
      return true
    },
    setDragging: (dragging, elapsed) => {
      setJellyfishDragging(motionState, dragging, elapsed)
    },
    hitTest: (raycaster) => hitTestJellyfish(root, raycaster),
    update,
    dispose: () => {
      scene.remove(root)
      const disposedMaterials = new Set<THREE.Material>()

      root.traverse((object) => {
        const mesh = object as THREE.Object3D & {
          geometry?: THREE.BufferGeometry
          material?: THREE.Material | THREE.Material[]
        }

        mesh.geometry?.dispose()

        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : []

        for (const material of materials) {
          if (disposedMaterials.has(material)) {
            continue
          }

          material.dispose()
          disposedMaterials.add(material)
        }
      })
    }
  }
}
