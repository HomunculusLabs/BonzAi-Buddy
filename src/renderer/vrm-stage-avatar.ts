import * as THREE from 'three'
import { VRM, VRMUtils } from '@pixiv/three-vrm'
import { MIN_SUBJECT_HEIGHT, type VrmSubjectMetrics } from './vrm-stage-scene'

export interface VrmAvatarHandle {
  metrics: VrmSubjectMetrics
  rootBasePosition: THREE.Vector3
  rootBaseRotation: THREE.Euler
  vrm: VRM
}

export function attachVrmAvatar(options: {
  hasLookAtTracks: boolean
  pointerTarget: THREE.Object3D
  scene: THREE.Scene
  vrm: VRM
}): VrmAvatarHandle {
  const { hasLookAtTracks, pointerTarget, scene, vrm } = options

  VRMUtils.rotateVRM0(vrm)
  normalizeVrmAppearance(vrm)

  vrm.scene.traverse((object) => {
    object.frustumCulled = false
  })

  scene.add(vrm.scene)

  if (vrm.lookAt) {
    vrm.lookAt.autoUpdate = !hasLookAtTracks
    vrm.lookAt.target = hasLookAtTracks ? null : pointerTarget
  }

  return {
    metrics: captureSubjectMetrics(vrm),
    rootBasePosition: vrm.scene.position.clone(),
    rootBaseRotation: vrm.scene.rotation.clone(),
    vrm
  }
}

export function refreshVrmAvatarBaseline(avatar: VrmAvatarHandle): void {
  avatar.metrics = captureSubjectMetrics(avatar.vrm)
  avatar.rootBasePosition.copy(avatar.vrm.scene.position)
  avatar.rootBaseRotation.copy(avatar.vrm.scene.rotation)
}

export function disposeVrmAvatar(scene: THREE.Scene, avatar: VrmAvatarHandle): void {
  avatar.vrm.lookAt?.reset()
  scene.remove(avatar.vrm.scene)
  VRMUtils.deepDispose(avatar.vrm.scene)
}

export function disposeUnusedVrmScene(root: THREE.Object3D): void {
  root.removeFromParent()
  VRMUtils.deepDispose(root)
}

function captureSubjectMetrics(vrm: VRM): VrmSubjectMetrics {
  const bounds = new THREE.Box3().setFromObject(vrm.scene)
  const center = new THREE.Vector3(0, 1.1, 0)
  const size = new THREE.Vector3(0.8, 1.6, 0.7)

  if (!bounds.isEmpty()) {
    bounds.getCenter(center)
    bounds.getSize(size)
  }

  return {
    center,
    rootHeight: Math.max(size.y, MIN_SUBJECT_HEIGHT),
    size
  }
}

function normalizeVrmAppearance(vrm: VRM): void {
  vrm.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh)) {
      return
    }

    object.castShadow = false
    object.receiveShadow = false

    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : []

    for (const [materialIndex, material] of materials.entries()) {
      if (!material) {
        continue
      }

      const maybeMToon = material as THREE.Material & {
        forceSinglePass?: boolean
        isMToonMaterial?: boolean
        isOutline?: boolean
        outlineWidthFactor?: number
        outlineWidthMode?: 'none' | 'worldCoordinates' | 'screenCoordinates'
      }

      if (maybeMToon.isOutline) {
        material.transparent = true
        material.opacity = 0
        material.colorWrite = false
        material.depthWrite = false
        material.needsUpdate = true
        continue
      }

      const isPrimaryOpaqueBodySlot =
        materialIndex === 0 &&
        materials.length > 1 &&
        material.opacity >= 1 &&
        !material.transparent &&
        material.side === THREE.DoubleSide

      if (isPrimaryOpaqueBodySlot) {
        material.side = THREE.FrontSide
        material.depthWrite = true
        material.needsUpdate = true
      }

      if (maybeMToon.isMToonMaterial || 'outlineWidthFactor' in maybeMToon) {
        maybeMToon.isOutline = false
        maybeMToon.outlineWidthMode = 'none'
        maybeMToon.outlineWidthFactor = 0
        maybeMToon.forceSinglePass = true
        maybeMToon.needsUpdate = true
      }
    }
  })
}
