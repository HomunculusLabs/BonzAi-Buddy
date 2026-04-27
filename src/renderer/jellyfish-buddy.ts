import * as THREE from 'three'
import type { AssistantEventEmoteId } from '../shared/contracts'
import { MIN_SUBJECT_HEIGHT, type VrmSubjectMetrics } from './vrm-stage-scene'

export interface JellyfishEmoteState {
  duration: number
  id: AssistantEventEmoteId
  startAt: number
}

export interface JellyfishMotionState {
  activeEmote: JellyfishEmoteState | null
  animationElapsed: number
  doubleClickStartAt: number
  dragReleaseStartAt: number
  isDragging: boolean
  nextSwimBurstAt: number
  swimBurstStartAt: number
}

export interface JellyfishFramePose {
  bellDetailsRotationYVelocity: number
  bellDetailsScale: THREE.Vector3
  bellPivotScale: THREE.Vector3
  coreGlowScale: THREE.Vector3
  glowLightIntensity: number
  oralGlowScale: THREE.Vector3
  rootPosition: THREE.Vector3
  rootRotationYVelocity: number
  rootRotationZ: number
  rootScale: THREE.Vector3
  skirtScale: THREE.Vector3
  tentacleEnergy: number
  tentacleWaveSway: number
}

type JellyfishTentacleStyle = 'ribbon' | 'filament' | 'oralArm'

interface JellyfishTentacle {
  angle: number
  baseRadius: number
  centers: THREE.Vector3[]
  geometry: THREE.BufferGeometry
  length: number
  phase: number
  positions: Float32Array
  segmentCount: number
  style: JellyfishTentacleStyle
  tipWidth: number
  waveScale: number
  width: number
}

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

const PRIMARY_TENTACLE_COUNT = 10
const ORAL_ARM_COUNT = 6
const SECONDARY_FILAMENT_COUNT = 14
const TENTACLE_SEGMENTS = 24
const SWIM_BURST_DURATION_SECONDS = 1.18
const DRAG_RELEASE_DURATION_SECONDS = 0.92
const DOUBLE_CLICK_BURST_DURATION_SECONDS = 1.05
const ribbonTangentScratch = new THREE.Vector3()
const ribbonViewScratch = new THREE.Vector3()
const ribbonSideScratch = new THREE.Vector3()
const filamentCenterScratch = new THREE.Vector3()

export function createJellyfishBuddy(scene: THREE.Scene): JellyfishBuddyHandle {
  const root = new THREE.Group()
  root.name = 'Jellyfish Buddy'
  root.position.set(0, 0.92, 0)

  const bellPivot = new THREE.Group()
  bellPivot.name = 'Jellyfish bell pivot'
  root.add(bellPivot)

  const bellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    depthTest: true,
    depthWrite: false,
    emissive: 0x2d8dff,
    emissiveIntensity: 0.18,
    metalness: 0,
    opacity: 0.42,
    roughness: 0.32,
    side: THREE.DoubleSide,
    transparent: true,
    vertexColors: true
  })

  const bell = new THREE.Mesh(createBellGeometry(), bellMaterial)
  bell.name = 'Jellyfish organic translucent bell'
  bell.position.y = 0.22
  bell.renderOrder = 32
  bellPivot.add(bell)

  const innerBell = new THREE.Mesh(
    createBellGeometry(),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xc8edff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.105,
      side: THREE.DoubleSide,
      transparent: true,
      vertexColors: true
    })
  )
  innerBell.name = 'Jellyfish faint inner bell'
  innerBell.position.y = 0.075
  innerBell.scale.set(0.74, 0.58, 0.74)
  innerBell.renderOrder = 28
  bellPivot.add(innerBell)

  const bellDetails = createBellDetails()
  bellDetails.root.position.y = 0.12
  bellPivot.add(bellDetails.root)

  const skirt = new THREE.Mesh(
    createScallopedRimGeometry(),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x86ccff,
      depthWrite: false,
      opacity: 0.12,
      transparent: true,
      vertexColors: true
    })
  )
  skirt.name = 'Jellyfish scalloped rim skirt'
  skirt.position.y = 0.055
  skirt.renderOrder = 36
  bellPivot.add(skirt)

  const oralGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 12),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x9edcff,
      depthWrite: false,
      opacity: 0.04,
      transparent: true
    })
  )
  oralGlow.name = 'Jellyfish warm oral glow'
  oralGlow.renderOrder = 20
  oralGlow.scale.set(0.46, 0.68, 0.36)
  oralGlow.position.y = -0.01
  bellPivot.add(oralGlow)

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x4f9dff,
      depthWrite: false,
      opacity: 0.055,
      transparent: true
    })
  )
  coreGlow.name = 'Jellyfish soft crown glow'
  coreGlow.renderOrder = 40
  coreGlow.scale.set(0.72, 0.42, 0.72)
  coreGlow.position.y = 0.16
  bellPivot.add(coreGlow)

  const glowLight = new THREE.PointLight(0x5ecbff, 1.2, 3.2, 2.2)
  glowLight.name = 'Jellyfish glow light'
  glowLight.position.set(0, 0.02, 0.1)
  root.add(glowLight)

  const tentacleRibbonMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0x9bddff,
    depthTest: true,
    depthWrite: false,
    opacity: 0.18,
    side: THREE.DoubleSide,
    transparent: true
  })
  const oralArmMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xb7e9ff,
    depthTest: true,
    depthWrite: false,
    opacity: 0.2,
    side: THREE.DoubleSide,
    transparent: true
  })
  const filamentMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xd7f4ff,
    depthTest: true,
    depthWrite: false,
    opacity: 0.075,
    transparent: true
  })

  const underBellRoot = new THREE.Group()
  underBellRoot.name = 'Jellyfish under-bell root'
  root.add(underBellRoot)

  const oralCoreGroup = new THREE.Group()
  oralCoreGroup.name = 'Jellyfish oral core ribbons'
  underBellRoot.add(oralCoreGroup)

  const tentacleRoot = new THREE.Group()
  tentacleRoot.name = 'Jellyfish layered tentacle field'
  underBellRoot.add(tentacleRoot)

  const tentacles: JellyfishTentacle[] = []

  for (let index = 0; index < PRIMARY_TENTACLE_COUNT; index += 1) {
    const angle = clusteredTentacleAngle(index, PRIMARY_TENTACLE_COUNT, 4, 0.3, 0.12)
    const segmentCount = TENTACLE_SEGMENTS
    const centers = createTentacleCenters(segmentCount)
    const positions = new Float32Array((segmentCount + 1) * 2 * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(createRibbonIndices(segmentCount))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.62, 0), 1.45)

    const ribbon = new THREE.Mesh(geometry, tentacleRibbonMaterial)
    ribbon.name = 'Jellyfish translucent ribbon tentacle'
    ribbon.renderOrder = 14
    tentacleRoot.add(ribbon)

    tentacles.push({
      angle,
      baseRadius: index % 4 === 0 ? 0.16 : index % 2 === 0 ? 0.24 : 0.34,
      centers,
      geometry,
      length: index % 7 === 0 ? 1.68 : index % 5 === 0 ? 1.45 : index % 3 === 0 ? 1.18 : 0.88,
      phase: index * 0.82,
      positions,
      segmentCount,
      style: 'ribbon',
      tipWidth: 0.0025 + (index % 3) * 0.001,
      waveScale: 0.48 + (index % 4) * 0.07,
      width: 0.018 + (index % 4) * 0.004
    })
  }

  for (let index = 0; index < ORAL_ARM_COUNT; index += 1) {
    const angle = clusteredTentacleAngle(index, ORAL_ARM_COUNT, ORAL_ARM_COUNT, 0.24, 0.44)
    const segmentCount = Math.round(TENTACLE_SEGMENTS * 0.65)
    const centers = createTentacleCenters(segmentCount)
    const positions = new Float32Array((segmentCount + 1) * 2 * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(createRibbonIndices(segmentCount))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.34, 0), 0.86)

    const oralArm = new THREE.Mesh(geometry, oralArmMaterial)
    oralArm.name = 'Jellyfish curled oral arm'
    oralArm.renderOrder = 18
    oralCoreGroup.add(oralArm)

    tentacles.push({
      angle,
      baseRadius: 0.035 + (index % 3) * 0.035,
      centers,
      geometry,
      length: index % 5 === 0 ? 0.86 : 0.56 + (index % 4) * 0.1,
      phase: index * 1.12 + 0.7,
      positions,
      segmentCount,
      style: 'oralArm',
      tipWidth: 0.018 + (index % 3) * 0.006,
      waveScale: 1.08 + (index % 3) * 0.13,
      width: 0.062 + (index % 3) * 0.02
    })
  }

  for (let index = 0; index < SECONDARY_FILAMENT_COUNT; index += 1) {
    const angle = clusteredTentacleAngle(index, SECONDARY_FILAMENT_COUNT, 4, 0.42, 0.28)
    const segmentCount = TENTACLE_SEGMENTS
    const centers = createTentacleCenters(segmentCount)
    const positions = new Float32Array((segmentCount + 1) * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.78, 0), 1.65)

    const line = new THREE.Line(geometry, filamentMaterial)
    line.name = 'Jellyfish fine filament'
    line.renderOrder = 10
    tentacleRoot.add(line)

    tentacles.push({
      angle,
      baseRadius: index % 6 === 0 ? 0.18 : index % 5 === 0 ? 0.24 : 0.31 + (index % 3) * 0.04,
      centers,
      geometry,
      length: index % 9 === 0 ? 1.92 : index % 7 === 0 ? 1.62 : index % 4 === 0 ? 1.34 : 1.02,
      phase: index * 0.58 + 0.4,
      positions,
      segmentCount,
      style: 'filament',
      tipWidth: 0,
      waveScale: 0.34 + (index % 4) * 0.05,
      width: 0
    })
  }

  const metrics: VrmSubjectMetrics = {
    center: new THREE.Vector3(0, 0.46, 0),
    rootHeight: Math.max(1.72, MIN_SUBJECT_HEIGHT),
    size: new THREE.Vector3(1.24, 1.78, 1.04)
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
    bellDetails.root.scale.copy(pose.bellDetailsScale)
    bellDetails.root.rotation.y += delta * pose.bellDetailsRotationYVelocity
    oralGlow.scale.copy(pose.oralGlowScale)
    coreGlow.scale.copy(pose.coreGlowScale)
    glowLight.intensity = pose.glowLightIntensity

    root.updateMatrixWorld(true)
    cameraLocalPosition.copy(cameraWorldPosition)
    root.worldToLocal(cameraLocalPosition)

    for (const tentacle of tentacles) {
      updateTentacle(
        tentacle,
        visualElapsed,
        pose.bellPivotScale.y,
        pose.tentacleEnergy,
        pose.tentacleWaveSway,
        cameraLocalPosition
      )
    }
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

function getJellyfishEventElapsed(state: JellyfishMotionState, fallbackElapsed: number): number {
  return Number.isFinite(state.animationElapsed) ? state.animationElapsed : fallbackElapsed
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

  const swim = Math.sin(elapsed * 2.05)
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
    swim * 0.03 +
    swimBurst * 0.12 +
    happyBounce * 0.16 +
    dragHold * 0.08 +
    dragRelease * 0.06 +
    doubleClickBurst * 0.22
  const tentacleEnergy =
    1 +
    swimBurst * 0.7 +
    happyBounce * 0.64 +
    Math.abs(waveSway) * 0.72 +
    dragHold * 0.8 +
    dragRelease * 0.58 +
    doubleClickBurst * 0.82
  const driftX =
    pointerNdc.x * 0.045 +
    Math.sin(elapsed * 0.62) * 0.035 +
    waveSway * 0.07 +
    dragWobble * 0.032
  const driftZ =
    Math.cos(elapsed * 0.52) * 0.025 -
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
        Math.sin(elapsed * 1.16) * 0.07 +
        swimBurst * 0.1 +
        happyBounce * 0.22 +
        dragRelease * 0.045 +
        doubleClickBurst * 0.16,
      driftZ
    ),
    rootRotationYVelocity:
      0.14 + swimBurst * 0.28 + happyBounce * 0.22 + doubleClickBurst * 3.3,
    rootRotationZ:
      -pointerNdc.x * 0.06 + waveSway * 0.18 + dragWobble * 0.15 + clickWobble * 0.06,
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

function createBellGeometry(): THREE.BufferGeometry {
  const radialSegments = 64
  const verticalSegments = 16
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const topColor = new THREE.Color(0xb7e5ff)
  const rimColor = new THREE.Color(0x7bbcff)
  const glowColor = new THREE.Color(0xd8f2ff)

  for (let yIndex = 0; yIndex <= verticalSegments; yIndex += 1) {
    const v = yIndex / verticalSegments
    const eased = 1 - Math.pow(1 - v, 1.78)
    const crownRoundness = Math.sin(v * Math.PI) * 0.018
    const baseRadius = 0.018 + Math.pow(Math.sin(v * Math.PI * 0.52), 0.88) * 0.53 + crownRoundness
    const shoulder = Math.sin(v * Math.PI) * 0.105
    const rimInfluence = Math.pow(v, 4.2)
    const y = 0.49 - eased * 0.56 + shoulder - rimInfluence * 0.052

    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const u = radialIndex / radialSegments
      const angle = u * Math.PI * 2
      const scallop = Math.sin(angle * 10) * 0.022 * rimInfluence
      const asymmetry = Math.sin(angle * 3.1 + 0.35) * 0.017 * Math.pow(v, 1.7)
      const softIrregularity = Math.sin(angle * 5 + v * 2.2) * 0.012 * Math.pow(v, 2.2)
      const radius = baseRadius + scallop + asymmetry + softIrregularity
      const vertexY =
        y +
        Math.sin(angle * 9 + 0.6) * 0.016 * rimInfluence +
        Math.sin(angle * 4.2) * 0.006 * Math.pow(v, 2.4)

      positions.push(Math.cos(angle) * radius * 1.08, vertexY, Math.sin(angle) * radius)

      const color = topColor.clone().lerp(rimColor, Math.pow(v, 1.45))
      color.lerp(glowColor, Math.max(0, 1 - Math.abs(v - 0.32) / 0.46) * 0.24)
      colors.push(color.r, color.g, color.b)
    }
  }

  const rowSize = radialSegments + 1

  for (let yIndex = 0; yIndex < verticalSegments; yIndex += 1) {
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const a = yIndex * rowSize + radialIndex
      const b = a + rowSize
      const c = a + 1
      const d = b + 1

      indices.push(a, b, c, c, b, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 0.82)

  return geometry
}

function createScallopedRimGeometry(): THREE.BufferGeometry {
  const radialSegments = 64
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const innerRadius = 0.36
  const outerRadius = 0.5
  const rimColor = new THREE.Color(0xa8e2ff)
  const foldColor = new THREE.Color(0x4f9ed8)

  for (let index = 0; index <= radialSegments; index += 1) {
    const t = index / radialSegments
    const angle = t * Math.PI * 2
    const scallop = Math.sin(angle * 10) * 0.022 + Math.sin(angle * 4.3) * 0.008
    const y = Math.sin(angle * 10 + 0.4) * 0.012 + Math.sin(angle * 3.1) * 0.006

    for (const edge of [0, 1]) {
      const radius = (edge === 0 ? innerRadius : outerRadius) + scallop * edge
      const droop = edge === 0 ? 0.012 : 0.055 + Math.sin(angle * 5.5) * 0.012
      positions.push(Math.cos(angle) * radius * 1.08, y - droop, Math.sin(angle) * radius)
      const color = rimColor.clone().lerp(foldColor, edge * 0.45)
      colors.push(color.r, color.g, color.b)
    }
  }

  for (let index = 0; index < radialSegments; index += 1) {
    const leftA = index * 2
    const rightA = leftA + 1
    const leftB = leftA + 2
    const rightB = leftA + 3
    indices.push(leftA, leftB, rightA, rightA, leftB, rightB)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

function clusteredTentacleAngle(
  index: number,
  total: number,
  clusterCount: number,
  spread: number,
  offset: number
): number {
  const clusterIndex = index % clusterCount
  const clusterSlot = Math.floor(index / clusterCount)
  const itemsPerCluster = Math.ceil(total / clusterCount)
  const center = (clusterIndex / clusterCount) * Math.PI * 2 + offset
  const slotCenter = (itemsPerCluster - 1) * 0.5
  const slotOffset = (clusterSlot - slotCenter) * spread
  const organicOffset = Math.sin(index * 2.17 + total * 0.31) * spread * 0.22

  return center + slotOffset + organicOffset
}

function createBellDetails(): { root: THREE.Group } {
  const root = new THREE.Group()
  root.name = 'Jellyfish faint radial veins'

  const spokeMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xbceeff,
    depthTest: true,
    depthWrite: false,
    opacity: 0.085,
    transparent: true
  })

  for (let index = 0; index < 20; index += 1) {
    const angle = (index / 20) * Math.PI * 2 + Math.sin(index * 1.7) * 0.025
    const positions: number[] = []

    for (let step = 0; step <= 5; step += 1) {
      const t = step / 5
      const radius = 0.08 + t * 0.36
      const droop = Math.sin(t * Math.PI) * 0.05
      positions.push(
        Math.cos(angle) * radius,
        -0.02 - droop - t * 0.035,
        Math.sin(angle) * radius
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    )

    const spoke = new THREE.Line(geometry, spokeMaterial)
    spoke.name = 'Jellyfish faint radial vein'
    spoke.renderOrder = 24
    root.add(spoke)
  }

  return { root }
}

function createTentacleCenters(segmentCount: number): THREE.Vector3[] {
  return Array.from({ length: segmentCount + 1 }, () => new THREE.Vector3())
}

function createRibbonIndices(segmentCount: number): number[] {
  const indices: number[] = []

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const leftA = segment * 2
    const rightA = leftA + 1
    const leftB = leftA + 2
    const rightB = leftA + 3

    indices.push(leftA, leftB, rightA, rightA, leftB, rightB)
  }

  return indices
}

function hitTestJellyfish(root: THREE.Object3D, raycaster: THREE.Raycaster): boolean {
  root.updateMatrixWorld(true)

  const inverseWorld = root.matrixWorld.clone().invert()
  const localRay = raycaster.ray.clone().applyMatrix4(inverseWorld)

  return (
    rayIntersectsEllipsoid(
      localRay,
      new THREE.Vector3(0, 0.3, 0),
      new THREE.Vector3(0.68, 0.42, 0.58)
    ) ||
    rayIntersectsCapsule(
      localRay,
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(-0.06, -1.15, 0),
      0.26
    )
  )
}

function rayIntersectsEllipsoid(
  ray: THREE.Ray,
  center: THREE.Vector3,
  radius: THREE.Vector3
): boolean {
  const origin = ray.origin.clone().sub(center).divide(radius)
  const direction = ray.direction.clone().divide(radius)
  const a = direction.dot(direction)
  const b = 2 * origin.dot(direction)
  const c = origin.dot(origin) - 1
  const discriminant = b * b - 4 * a * c

  if (discriminant < 0) {
    return false
  }

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const nearT = (-b - sqrtDiscriminant) / (2 * a)
  const farT = (-b + sqrtDiscriminant) / (2 * a)

  return nearT >= 0 || farT >= 0
}

function rayIntersectsCapsule(
  ray: THREE.Ray,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number
): boolean {
  return ray.distanceSqToSegment(start, end) <= radius * radius
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

function updateTentacle(
  tentacle: JellyfishTentacle,
  elapsed: number,
  pulse: number,
  energy: number,
  waveSway: number,
  cameraLocalPosition: THREE.Vector3
): void {
  const lagSeconds =
    tentacle.style === 'oralArm' ? 0.12 : tentacle.style === 'ribbon' ? 0.22 : 0.32
  const laggedElapsed = elapsed - lagSeconds * (0.7 + energy * 0.08)
  const laggedPulse =
    1 +
    (pulse - 1) *
      (tentacle.style === 'oralArm' ? 0.78 : tentacle.style === 'ribbon' ? 0.56 : 0.38)

  if (tentacle.style === 'ribbon' || tentacle.style === 'oralArm') {
    updateRibbonTentacle(
      tentacle,
      laggedElapsed,
      laggedPulse,
      energy,
      waveSway,
      cameraLocalPosition
    )
    return
  }

  updateFilamentTentacle(tentacle, laggedElapsed, laggedPulse, energy, waveSway)
}

function updateRibbonTentacle(
  tentacle: JellyfishTentacle,
  elapsed: number,
  pulse: number,
  energy: number,
  waveSway: number,
  cameraLocalPosition: THREE.Vector3
): void {
  const { centers, segmentCount, positions, tipWidth, width } = tentacle

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    computeTentacleCenter(tentacle, segment, elapsed, pulse, energy, waveSway, centers[segment])
  }

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    const t = segment / segmentCount
    const previous = centers[Math.max(0, segment - 1)]
    const next = centers[Math.min(segmentCount, segment + 1)]
    ribbonTangentScratch.subVectors(next, previous).normalize()
    ribbonViewScratch.subVectors(cameraLocalPosition, centers[segment]).normalize()
    ribbonSideScratch.crossVectors(ribbonViewScratch, ribbonTangentScratch)

    if (ribbonSideScratch.lengthSq() < 0.0001) {
      ribbonSideScratch.set(1, 0, 0)
    } else {
      ribbonSideScratch.normalize()
    }

    const flutter = 1 + Math.sin(elapsed * 0.82 + tentacle.phase + t * 6.5) * 0.035
    const taperProgress =
      tentacle.style === 'oralArm' ? Math.pow(t, 0.9) : Math.pow(t, 1.25)
    const halfWidth = THREE.MathUtils.lerp(width, tipWidth, taperProgress) * flutter
    const center = centers[segment]
    const index = segment * 6

    positions[index] = center.x - ribbonSideScratch.x * halfWidth
    positions[index + 1] = center.y - ribbonSideScratch.y * halfWidth
    positions[index + 2] = center.z - ribbonSideScratch.z * halfWidth
    positions[index + 3] = center.x + ribbonSideScratch.x * halfWidth
    positions[index + 4] = center.y + ribbonSideScratch.y * halfWidth
    positions[index + 5] = center.z + ribbonSideScratch.z * halfWidth
  }

  tentacle.geometry.attributes.position.needsUpdate = true
}

function updateFilamentTentacle(
  tentacle: JellyfishTentacle,
  elapsed: number,
  pulse: number,
  energy: number,
  waveSway: number
): void {
  const { positions, segmentCount } = tentacle

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    computeTentacleCenter(tentacle, segment, elapsed, pulse, energy, waveSway, filamentCenterScratch)
    const index = segment * 3

    positions[index] = filamentCenterScratch.x
    positions[index + 1] = filamentCenterScratch.y
    positions[index + 2] = filamentCenterScratch.z
  }

  tentacle.geometry.attributes.position.needsUpdate = true
}

function computeTentacleCenter(
  tentacle: JellyfishTentacle,
  segment: number,
  elapsed: number,
  pulse: number,
  energy: number,
  waveSway: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const { angle, baseRadius, length, phase, segmentCount, waveScale } = tentacle
  const t = segment / segmentCount
  const falloff = t * t
  const segmentLag =
    t * (tentacle.style === 'oralArm' ? 0.08 : tentacle.style === 'ribbon' ? 0.16 : 0.22)
  const localElapsed = elapsed - segmentLag
  const wave =
    Math.sin(localElapsed * (0.72 + energy * 0.035) + phase + t * 3.1) *
    0.042 *
    energy *
    waveScale *
    falloff
  const crossWave =
    (Math.cos(localElapsed * 0.52 + phase * 1.3 + t * 3.5) * 0.03 +
      waveSway * 0.035) *
    energy *
    waveScale *
    falloff
  const taperRadius = baseRadius * (1 - t * (tentacle.style === 'oralArm' ? 0.32 : 0.58))
  const outwardArc =
    tentacle.style === 'oralArm'
      ? Math.sin(phase * 1.7) * 0.04 * Math.sin(t * Math.PI)
      : tentacle.style === 'ribbon'
        ? Math.sin(phase * 0.9) * 0.075 * Math.sin(t * Math.PI * 0.82)
        : Math.sin(phase * 0.8) * 0.11 * Math.sin(t * Math.PI * 0.72)
  const currentAmount =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 1.55 + phase) * 0.082 * Math.sin(t * Math.PI)
      : tentacle.style === 'ribbon'
        ? Math.sin(t * Math.PI * 1.18 + phase * 0.7) * 0.064 * Math.pow(t, 1.2)
        : Math.sin(t * Math.PI * 1.02 + phase * 0.5) * 0.085 * Math.pow(t, 1.4)
  const curl =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 2.7 + phase) * 0.12 * Math.sin(t * Math.PI)
      : 0
  const startY =
    tentacle.style === 'oralArm'
      ? -0.055 + Math.sin(phase) * 0.026
      : tentacle.style === 'ribbon'
        ? 0.0 + Math.sin(phase * 0.7) * 0.035
        : -0.012 + Math.sin(phase * 0.9) * 0.04
  const oralFold =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 1.85 + phase * 0.6) * 0.052 * t
      : 0
  const sideMotion = wave + curl + currentAmount
  const radialRadius = taperRadius + outwardArc

  const horizontalScale = 1.02 - (pulse - 1) * 0.65

  return target.set(
    (Math.cos(angle) * radialRadius + Math.cos(angle + Math.PI / 2) * sideMotion) * horizontalScale,
    startY - length * t + Math.sin(localElapsed * 1.1 + phase) * 0.025 * t + oralFold,
    (Math.sin(angle) * radialRadius + Math.sin(angle + Math.PI / 2) * sideMotion + crossWave) * horizontalScale
  )
}
