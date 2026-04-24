import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import type { AssistantEventEmoteId } from '../shared/contracts'
import { resolveStageAnimationSet } from './vrma-animation-resolver'

interface VrmStageCallbacks {
  onStatusChange?: (message: string) => void
  onErrorChange?: (message: string | null) => void
}

export interface VrmStageController {
  dispose: () => void
  load: (assetPath: string) => Promise<void>
  playBuiltInEmote: (emoteId: AssistantEventEmoteId) => boolean
}

type AnimationPhase = 'idle' | 'emote' | 'returning'

interface EmoteActionState {
  action: THREE.AnimationAction
  duration: number
  name: string
}

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

const MIN_HEIGHT = 1.45
const MAX_PIXEL_RATIO = 2
const EMOTE_FADE_SECONDS = 0.85
const MIN_EMOTE_INTERVAL_SECONDS = 8
const MAX_EMOTE_INTERVAL_SECONDS = 14

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
  const rootBasePosition = new THREE.Vector3()
  const rootBaseRotation = new THREE.Euler()
  const lights = createLights()
  const resizeObserver = new ResizeObserver(() => {
    resizeRenderer()
    frameSubject()
  })

  let animationFrameId = 0
  let activeLoadId = 0
  let animationTimeSeconds = 0
  let disposed = false
  let currentAnimationState: VrmAnimationState | null = null
  let currentRootHeight = MIN_HEIGHT
  let currentVrm: VRM | null = null

  scene.add(pointerTarget)
  scene.add(lights.hemisphere, lights.key, lights.rim)

  loader.register((parser) => new VRMLoaderPlugin(parser))
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

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
        disposeUnusedScene(gltf.scene)
        return
      }

      const vrm = (gltf.userData as { vrm?: VRM }).vrm

      if (!vrm) {
        throw new Error('The loaded asset did not expose a VRM instance.')
      }

      callbacks.onStatusChange?.('VRM model ready — loading animation assets…')
      const resolvedAnimationSet = await resolveStageAnimationSet(loader, vrm)

      if (disposed || loadId !== activeLoadId) {
        disposeUnusedScene(vrm.scene)
        return
      }

      finalizeLoadedVrm(vrm, resolvedAnimationSet)
      callbacks.onStatusChange?.(currentAnimationState?.statusMessage ?? 'VRM ready')
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
    resolvedAnimationSet: Awaited<ReturnType<typeof resolveStageAnimationSet>>
  ): void {
    currentVrm = vrm

    VRMUtils.rotateVRM0(vrm)
    normalizeVrmAppearance(vrm)

    vrm.scene.traverse((object) => {
      object.frustumCulled = false
    })

    scene.add(vrm.scene)

    if (vrm.lookAt) {
      vrm.lookAt.autoUpdate = !resolvedAnimationSet.hasLookAtTracks
      vrm.lookAt.target = resolvedAnimationSet.hasLookAtTracks ? null : pointerTarget
    }

    currentAnimationState = createAnimationState(
      vrm,
      resolvedAnimationSet,
      animationTimeSeconds
    )
    currentAnimationState.mixer.update(0)
    vrm.update(0)

    currentRootHeight = captureSubjectMetrics(vrm)
    rootBasePosition.copy(vrm.scene.position)
    rootBaseRotation.copy(vrm.scene.rotation)

    frameSubject()
  }

  function createAnimationState(
    vrm: VRM,
    resolvedAnimationSet: Awaited<ReturnType<typeof resolveStageAnimationSet>>,
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

    const focusY = subjectCenter.y + currentRootHeight * 0.28
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5)
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect)
    const fitHeightDistance = (currentRootHeight * 0.72) / Math.tan(halfVerticalFov)
    const fitWidthDistance =
      (Math.max(subjectSize.x, 0.75) * 0.78) / Math.tan(halfHorizontalFov)
    const distance = Math.max(fitHeightDistance, fitWidthDistance) + subjectSize.z * 1.28

    cameraTarget.set(subjectCenter.x, focusY, subjectCenter.z)
    camera.position.set(
      subjectCenter.x + 0.04,
      subjectCenter.y + currentRootHeight * 0.56,
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
      animationTimeSeconds += delta

      pointerNdc.lerp(desiredPointerNdc, 1 - Math.exp(-delta * 10))
      updatePointerTarget(delta)

      if (currentVrm) {
        updateAnimationState(animationTimeSeconds)
        currentAnimationState?.mixer.update(delta)
        applyCursorReaction(currentVrm, delta)
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
      cameraTarget.y - currentRootHeight * 0.1 + pointerNdc.y * verticalRange,
      camera.position.z - currentRootHeight * 0.34
    )

    pointerTarget.position.lerp(desiredLookTarget, 1 - Math.exp(-delta * 12))
  }

  function updateAnimationState(elapsed: number): void {
    if (!currentAnimationState) {
      return
    }

    if (
      currentAnimationState.phase === 'idle' &&
      elapsed >= currentAnimationState.nextEmoteAt
    ) {
      startRandomEmote(currentAnimationState, elapsed)
      return
    }

    if (
      currentAnimationState.phase === 'emote' &&
      currentAnimationState.activeEmote &&
      elapsed >= currentAnimationState.returnAt
    ) {
      beginReturnToIdle(currentAnimationState, elapsed)
      return
    }

    if (
      currentAnimationState.phase === 'returning' &&
      currentAnimationState.activeEmote &&
      elapsed >= currentAnimationState.returnEndAt
    ) {
      finishReturningEmote(currentAnimationState, elapsed)
    }
  }

  function playBuiltInEmote(emoteId: AssistantEventEmoteId): boolean {
    if (disposed || !currentAnimationState || !currentVrm) {
      return false
    }

    const emote = currentAnimationState.emotes.find(
      (candidate) => candidate.name === emoteId
    )

    if (!emote) {
      return false
    }

    startEmote(currentAnimationState, emote, animationTimeSeconds)
    return true
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

  function applyCursorReaction(vrm: VRM, delta: number): void {
    const positionLerp = 1 - Math.exp(-delta * 8)
    const rotationLerp = 1 - Math.exp(-delta * 9)
    const targetX = rootBasePosition.x + pointerNdc.x * currentRootHeight * 0.025
    const targetY = rootBasePosition.y + pointerNdc.y * currentRootHeight * 0.01
    const targetRotX = rootBaseRotation.x + pointerNdc.y * 0.035
    const targetRotY = rootBaseRotation.y + pointerNdc.x * 0.07
    const targetRotZ = rootBaseRotation.z - pointerNdc.x * 0.02

    vrm.scene.position.x = THREE.MathUtils.lerp(vrm.scene.position.x, targetX, positionLerp)
    vrm.scene.position.y = THREE.MathUtils.lerp(vrm.scene.position.y, targetY, positionLerp)
    vrm.scene.rotation.x = THREE.MathUtils.lerp(vrm.scene.rotation.x, targetRotX, rotationLerp)
    vrm.scene.rotation.y = THREE.MathUtils.lerp(vrm.scene.rotation.y, targetRotY, rotationLerp)
    vrm.scene.rotation.z = THREE.MathUtils.lerp(vrm.scene.rotation.z, targetRotZ, rotationLerp)
  }

  function resizeRenderer(): void {
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
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

  function disposeUnusedScene(root: THREE.Object3D): void {
    root.removeFromParent()
    VRMUtils.deepDispose(root)
  }

  function clearCurrentVrm(): void {
    if (currentAnimationState && currentVrm) {
      currentAnimationState.mixer.stopAllAction()
      currentAnimationState.mixer.uncacheRoot(currentVrm.scene)
    }

    currentAnimationState = null

    if (!currentVrm) {
      currentRootHeight = MIN_HEIGHT
      return
    }

    currentVrm.lookAt?.reset()

    scene.remove(currentVrm.scene)
    VRMUtils.deepDispose(currentVrm.scene)
    currentVrm = null
    currentRootHeight = MIN_HEIGHT
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
