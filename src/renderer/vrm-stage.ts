import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  VRM,
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils
} from '@pixiv/three-vrm'

interface IdleBoneState {
  bone: THREE.Object3D
  baseQuaternion: THREE.Quaternion
}

interface VrmStageCallbacks {
  onStatusChange?: (message: string) => void
  onErrorChange?: (message: string | null) => void
}

export interface VrmStageController {
  dispose: () => void
  load: (assetPath: string) => Promise<void>
}

const MIN_HEIGHT = 1.45
const MAX_PIXEL_RATIO = 2

export function createVrmStage(
  canvas: HTMLCanvasElement,
  callbacks: VrmStageCallbacks = {}
): VrmStageController {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  })
  const loader = new GLTFLoader()
  const clock = new THREE.Clock()
  const pointerNdc = new THREE.Vector2(0, 0.08)
  const desiredPointerNdc = new THREE.Vector2(0, 0.08)
  const pointerTarget = new THREE.Object3D()
  const cameraTarget = new THREE.Vector3(0, 1.25, 0)
  const subjectCenter = new THREE.Vector3(0, 1.1, 0)
  const subjectSize = new THREE.Vector3(0.8, 1.6, 0.7)
  const desiredLookTarget = new THREE.Vector3(0, 1.35, 0)
  const headWorldPosition = new THREE.Vector3()
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const quaternion = new THREE.Quaternion()
  const lights = createLights()
  const resizeObserver = new ResizeObserver(() => {
    resizeRenderer()
    frameSubject()
  })

  let animationFrameId = 0
  let activeLoadId = 0
  let disposed = false
  let currentVrm: VRM | null = null
  let currentRootHeight = MIN_HEIGHT
  let rootBaseY = 0
  let rootBaseRotationY = 0
  let idleBones: Partial<Record<'chest' | 'neck' | 'head', IdleBoneState>> = {}

  scene.add(pointerTarget)
  scene.add(lights.hemisphere, lights.key, lights.rim)

  loader.register((parser) => new VRMLoaderPlugin(parser))

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08

  resizeObserver.observe(canvas)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('resize', resizeRenderer)

  resizeRenderer()
  startAnimationLoop()

  return {
    dispose,
    load
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
        return
      }

      const vrm = (gltf.userData as { vrm?: VRM }).vrm

      if (!vrm) {
        throw new Error('The loaded asset did not expose a VRM instance.')
      }

      finalizeLoadedVrm(vrm)
      callbacks.onStatusChange?.('VRM ready — move your cursor over Bonzi.')
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

  function finalizeLoadedVrm(vrm: VRM): void {
    currentVrm = vrm

    VRMUtils.rotateVRM0(vrm)

    vrm.scene.traverse((object) => {
      object.frustumCulled = false
    })

    scene.add(vrm.scene)

    if (vrm.lookAt) {
      vrm.lookAt.autoUpdate = true
      vrm.lookAt.target = pointerTarget
    }

    currentRootHeight = captureSubjectMetrics(vrm)
    captureIdleBoneStates(vrm)
    rootBaseY = vrm.scene.position.y
    rootBaseRotationY = vrm.scene.rotation.y

    frameSubject()
  }

  function captureSubjectMetrics(vrm: VRM): number {
    const bounds = new THREE.Box3().setFromObject(vrm.scene)

    if (bounds.isEmpty()) {
      subjectCenter.set(0, 1.1, 0)
      subjectSize.set(0.8, 1.6, 0.7)
      return subjectSize.y
    }

    bounds.getCenter(subjectCenter)
    bounds.getSize(subjectSize)

    return Math.max(subjectSize.y, MIN_HEIGHT)
  }

  function captureIdleBoneStates(vrm: VRM): void {
    idleBones = {
      chest: getIdleBone(
        vrm,
        VRMHumanBoneName.UpperChest,
        VRMHumanBoneName.Chest,
        VRMHumanBoneName.Spine
      ),
      neck: getIdleBone(vrm, VRMHumanBoneName.Neck),
      head: getIdleBone(vrm, VRMHumanBoneName.Head)
    }
  }

  function getIdleBone(
    vrm: VRM,
    ...boneNames: Array<(typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]>
  ): IdleBoneState | undefined {
    for (const boneName of boneNames) {
      const bone = vrm.humanoid.getNormalizedBoneNode(boneName)

      if (bone) {
        return {
          bone,
          baseQuaternion: bone.quaternion.clone()
        }
      }
    }

    return undefined
  }

  function frameSubject(): void {
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)

    camera.aspect = width / height
    camera.updateProjectionMatrix()

    if (!currentVrm) {
      camera.position.set(0, 1.35, 4.2)
      camera.lookAt(cameraTarget)
      pointerTarget.position.copy(cameraTarget)
      return
    }

    const focusY = subjectCenter.y + currentRootHeight * 0.13
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5)
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect)
    const fitHeightDistance = (currentRootHeight * 0.58) / Math.tan(halfVerticalFov)
    const fitWidthDistance =
      (Math.max(subjectSize.x, 0.75) * 0.72) / Math.tan(halfHorizontalFov)
    const distance = Math.max(fitHeightDistance, fitWidthDistance) + subjectSize.z * 1.2

    cameraTarget.set(subjectCenter.x, focusY, subjectCenter.z)
    camera.position.set(
      subjectCenter.x + 0.04,
      subjectCenter.y + currentRootHeight * 0.55,
      subjectCenter.z + distance
    )
    camera.lookAt(cameraTarget)

    lights.key.position.set(
      subjectCenter.x + currentRootHeight * 0.55,
      subjectCenter.y + currentRootHeight * 1.15,
      subjectCenter.z + distance * 0.85
    )
    lights.rim.position.set(
      subjectCenter.x - currentRootHeight * 0.75,
      subjectCenter.y + currentRootHeight * 0.95,
      subjectCenter.z - distance * 0.55
    )

    pointerTarget.position.set(
      cameraTarget.x,
      cameraTarget.y + currentRootHeight * 0.12,
      camera.position.z - currentRootHeight * 0.32
    )
  }

  function startAnimationLoop(): void {
    const tick = (): void => {
      if (disposed) {
        return
      }

      animationFrameId = window.requestAnimationFrame(tick)

      const delta = Math.min(clock.getDelta(), 1 / 20)
      const elapsed = clock.elapsedTime

      pointerNdc.lerp(desiredPointerNdc, 1 - Math.exp(-delta * 10))
      updatePointerTarget(delta)

      if (currentVrm) {
        applyIdleMotion(currentVrm, elapsed)
        currentVrm.update(delta)
      }

      renderer.render(scene, camera)
    }

    tick()
  }

  function updatePointerTarget(delta: number): void {
    const lateralRange = currentRootHeight * 0.18
    const verticalRange = currentRootHeight * 0.12

    desiredLookTarget.set(
      cameraTarget.x + pointerNdc.x * lateralRange,
      cameraTarget.y + currentRootHeight * 0.16 + pointerNdc.y * verticalRange,
      camera.position.z - currentRootHeight * 0.34
    )

    pointerTarget.position.lerp(desiredLookTarget, 1 - Math.exp(-delta * 12))
  }

  function applyIdleMotion(vrm: VRM, elapsed: number): void {
    const bobOffset = Math.sin(elapsed * 1.4) * currentRootHeight * 0.008
    const swayOffset = Math.sin(elapsed * 0.6) * 0.06 + pointerNdc.x * 0.04

    vrm.scene.position.y = rootBaseY + bobOffset
    vrm.scene.rotation.y = rootBaseRotationY + swayOffset

    applyBoneOffset(
      idleBones.chest,
      Math.sin(elapsed * 1.4 + 0.25) * 0.025,
      pointerNdc.x * 0.05,
      Math.sin(elapsed * 0.7) * 0.015
    )
    applyBoneOffset(
      idleBones.neck,
      Math.sin(elapsed * 1.1 + 0.7) * 0.012 + pointerNdc.y * 0.04,
      pointerNdc.x * 0.055,
      0
    )
    applyBoneOffset(
      idleBones.head,
      Math.sin(elapsed * 0.9 + 1.25) * 0.01 + pointerNdc.y * 0.02,
      pointerNdc.x * 0.03,
      0
    )
  }

  function applyBoneOffset(
    idleBone: IdleBoneState | undefined,
    x: number,
    y: number,
    z: number
  ): void {
    if (!idleBone) {
      return
    }

    idleBone.bone.quaternion.copy(idleBone.baseQuaternion)
    quaternion.setFromEuler(euler.set(x, y, z, 'YXZ'))
    idleBone.bone.quaternion.multiply(quaternion)
  }

  function resizeRenderer(): void {
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function clearCurrentVrm(): void {
    if (!currentVrm) {
      idleBones = {}
      return
    }

    currentVrm.lookAt?.reset()

    currentVrm.scene.getWorldPosition(headWorldPosition)
    scene.remove(currentVrm.scene)
    VRMUtils.deepDispose(currentVrm.scene)
    currentVrm = null
    idleBones = {}
  }

  function onPointerMove(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect()

    if (rect.width <= 0 || rect.height <= 0) {
      return
    }

    desiredPointerNdc.set(
      THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1)
    )
  }

  function onPointerLeave(): void {
    desiredPointerNdc.set(0, 0.08)
  }

  function dispose(): void {
    disposed = true

    window.cancelAnimationFrame(animationFrameId)
    resizeObserver.disconnect()
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    window.removeEventListener('resize', resizeRenderer)

    clearCurrentVrm()
    renderer.dispose()
  }
}

function createLights(): {
  hemisphere: THREE.HemisphereLight
  key: THREE.DirectionalLight
  rim: THREE.PointLight
} {
  const hemisphere = new THREE.HemisphereLight(0xe6ecff, 0x211a3d, 1.85)

  const key = new THREE.DirectionalLight(0xffffff, 1.9)
  key.position.set(2.3, 3.4, 4.8)

  const rim = new THREE.PointLight(0x9f7dff, 1.15, 18, 2)
  rim.position.set(-1.8, 2.1, -2.4)

  return {
    hemisphere,
    key,
    rim
  }
}
