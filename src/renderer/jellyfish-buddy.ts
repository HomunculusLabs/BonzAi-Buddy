import * as THREE from 'three'
import type { AssistantEventEmoteId } from '../shared/contracts'
import { MIN_SUBJECT_HEIGHT, type VrmSubjectMetrics } from './vrm-stage-scene'

interface JellyfishEmoteState {
  duration: number
  id: AssistantEventEmoteId
  startAt: number
}

interface JellyfishTentacle {
  angle: number
  baseRadius: number
  geometry: THREE.BufferGeometry
  length: number
  phase: number
  positions: Float32Array
  segmentCount: number
  waveScale: number
}

export interface JellyfishBuddyHandle {
  metrics: VrmSubjectMetrics
  root: THREE.Group
  playBuiltInEmote(emoteId: AssistantEventEmoteId, elapsed: number): boolean
  playDoubleClickAnimation(elapsed: number): boolean
  setDragging(dragging: boolean, elapsed: number): void
  update(delta: number, elapsed: number, pointerNdc: THREE.Vector2): void
  dispose(): void
}

const TENTACLE_COUNT = 10
const TENTACLE_SEGMENTS = 26
const SWIM_BURST_DURATION_SECONDS = 1.18
const DRAG_RELEASE_DURATION_SECONDS = 0.92
const DOUBLE_CLICK_BURST_DURATION_SECONDS = 1.05

export function createJellyfishBuddy(scene: THREE.Scene): JellyfishBuddyHandle {
  const root = new THREE.Group()
  root.name = 'Jellyfish Buddy'
  root.position.set(0, 0.92, 0)

  const bellPivot = new THREE.Group()
  bellPivot.name = 'Jellyfish bell pivot'
  root.add(bellPivot)

  const bellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    depthWrite: false,
    emissive: 0x2a6fff,
    emissiveIntensity: 0.3,
    metalness: 0,
    opacity: 0.5,
    roughness: 0.2,
    side: THREE.DoubleSide,
    transparent: true,
    transmission: 0.24,
    vertexColors: true
  })

  const bell = new THREE.Mesh(createBellGeometry(), bellMaterial)
  bell.name = 'Jellyfish organic translucent bell'
  bell.position.y = 0.22
  bellPivot.add(bell)

  const bellDetails = createBellDetails()
  bellDetails.root.position.y = 0.12
  bellPivot.add(bellDetails.root)

  const skirt = new THREE.Mesh(
    new THREE.TorusGeometry(0.43, 0.008, 8, 64),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xb7efff,
      depthWrite: false,
      opacity: 0.08,
      transparent: true
    })
  )
  skirt.name = 'Jellyfish glowing skirt'
  skirt.rotation.x = Math.PI / 2
  skirt.position.y = 0.055
  bellPivot.add(skirt)

  const oralGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 12),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffd8f2,
      depthWrite: false,
      opacity: 0.07,
      transparent: true
    })
  )
  oralGlow.name = 'Jellyfish warm oral glow'
  oralGlow.scale.set(0.55, 0.82, 0.42)
  oralGlow.position.y = -0.01
  bellPivot.add(oralGlow)

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x7c9cff,
      depthWrite: false,
      opacity: 0.1,
      transparent: true
    })
  )
  coreGlow.name = 'Jellyfish soft core glow'
  coreGlow.scale.set(0.72, 0.42, 0.72)
  coreGlow.position.y = 0.16
  bellPivot.add(coreGlow)

  const glowLight = new THREE.PointLight(0x7ddfff, 1.2, 3.2, 2.2)
  glowLight.name = 'Jellyfish glow light'
  glowLight.position.set(0, 0.02, 0.1)
  root.add(glowLight)

  const tentacleMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xc7efff,
    depthWrite: false,
    opacity: 0.5,
    transparent: true
  })

  const tentacles: JellyfishTentacle[] = []

  for (let index = 0; index < TENTACLE_COUNT; index += 1) {
    const angle = (index / TENTACLE_COUNT) * Math.PI * 2
    const segmentCount = TENTACLE_SEGMENTS
    const positions = new Float32Array((segmentCount + 1) * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.7, 0), 1.5)

    const line = new THREE.Line(geometry, tentacleMaterial)
    line.name = 'Jellyfish soft tendril'
    root.add(line)

    tentacles.push({
      angle,
      baseRadius: index % 2 === 0 ? 0.28 : 0.36,
      geometry,
      length: index % 3 === 0 ? 1.34 : 1.08,
      phase: index * 0.82,
      positions,
      segmentCount,
      waveScale: 0.58 + (index % 3) * 0.08
    })
  }

  const metrics: VrmSubjectMetrics = {
    center: new THREE.Vector3(0, 0.46, 0),
    rootHeight: Math.max(1.72, MIN_SUBJECT_HEIGHT),
    size: new THREE.Vector3(1.24, 1.78, 1.04)
  }

  scene.add(root)

  let activeEmote: JellyfishEmoteState | null = null
  let doubleClickStartAt = Number.NEGATIVE_INFINITY
  let dragReleaseStartAt = Number.NEGATIVE_INFINITY
  let isDragging = false
  let nextSwimBurstAt = 1.4
  let swimBurstStartAt = Number.NEGATIVE_INFINITY

  const update = (delta: number, elapsed: number, pointerNdc: THREE.Vector2): void => {
    if (elapsed >= nextSwimBurstAt) {
      swimBurstStartAt = elapsed
      nextSwimBurstAt = elapsed + 3.8 + (Math.sin(elapsed * 0.63) + 1) * 1.1
    }

    if (activeEmote && elapsed >= activeEmote.startAt + activeEmote.duration) {
      activeEmote = null
    }

    const swim = Math.sin(elapsed * 2.05)
    const swimBurst = animationEnvelope(elapsed, swimBurstStartAt, SWIM_BURST_DURATION_SECONDS)
    const dragRelease = animationEnvelope(
      elapsed,
      dragReleaseStartAt,
      DRAG_RELEASE_DURATION_SECONDS
    )
    const doubleClickBurst = animationEnvelope(
      elapsed,
      doubleClickStartAt,
      DOUBLE_CLICK_BURST_DURATION_SECONDS
    )
    const dragHold = isDragging ? 1 : 0
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

    root.position.x = THREE.MathUtils.lerp(root.position.x, driftX, 1 - Math.exp(-delta * 2.6))
    root.position.y =
      0.92 +
      Math.sin(elapsed * 1.16) * 0.07 +
      swimBurst * 0.1 +
      happyBounce * 0.22 +
      dragRelease * 0.045 +
      doubleClickBurst * 0.16
    root.position.z = THREE.MathUtils.lerp(root.position.z, driftZ, 1 - Math.exp(-delta * 2.2))
    root.rotation.y +=
      delta *
      (0.14 + swimBurst * 0.28 + happyBounce * 0.22 + doubleClickBurst * 3.3)
    root.rotation.z = THREE.MathUtils.lerp(
      root.rotation.z,
      -pointerNdc.x * 0.06 + waveSway * 0.18 + dragWobble * 0.15 + clickWobble * 0.06,
      1 - Math.exp(-delta * 3.5)
    )
    root.scale.set(
      1 + dragHold * 0.04 + dragRelease * 0.025 + doubleClickBurst * 0.07,
      1 - dragHold * 0.065 + dragRelease * 0.035 + doubleClickBurst * 0.09,
      1 + dragHold * 0.04 + dragRelease * 0.025 + doubleClickBurst * 0.07
    )

    bellPivot.scale.set(1 / pulse, pulse, 1 / pulse)
    skirt.scale.set(
      1 + swim * 0.03 + swimBurst * 0.06 + doubleClickBurst * 0.1,
      1,
      1 + swim * 0.03 + swimBurst * 0.06 + doubleClickBurst * 0.1
    )
    bellDetails.root.scale.set(
      1 + swim * 0.018 + swimBurst * 0.035,
      1 + swim * 0.024 + swimBurst * 0.045,
      1 + swim * 0.018 + swimBurst * 0.035
    )
    bellDetails.root.rotation.y += delta * (0.025 + doubleClickBurst * 0.12)
    oralGlow.scale.set(
      0.55 + swim * 0.025 + happyBounce * 0.06 + doubleClickBurst * 0.1,
      0.82 + swimBurst * 0.08 + doubleClickBurst * 0.08,
      0.42 + swim * 0.02 + happyBounce * 0.05
    )
    coreGlow.scale.set(
      0.72 + swim * 0.025 + happyBounce * 0.06 + doubleClickBurst * 0.1,
      0.42 + swim * 0.018 + swimBurst * 0.05 + doubleClickBurst * 0.07,
      0.72 + swim * 0.025 + happyBounce * 0.06 + doubleClickBurst * 0.1
    )
    glowLight.intensity =
      1.1 +
      Math.max(0, swim) * 0.28 +
      swimBurst * 0.58 +
      happyBounce * 0.8 +
      dragHold * 0.42 +
      dragRelease * 0.28 +
      doubleClickBurst * 1.35

    for (const tentacle of tentacles) {
      updateTentacle(
        tentacle,
        elapsed,
        pulse,
        tentacleEnergy,
        waveSway + dragWobble * 0.3 + clickWobble * 0.12
      )
    }
  }

  update(0, 0, new THREE.Vector2())

  return {
    metrics,
    root,
    playBuiltInEmote: (emoteId, elapsed) => {
      activeEmote = {
        duration: emoteId === 'happy-bounce' ? 1.45 : 1.8,
        id: emoteId,
        startAt: elapsed
      }
      swimBurstStartAt = elapsed
      nextSwimBurstAt = Math.max(nextSwimBurstAt, elapsed + 2.2)
      return true
    },
    playDoubleClickAnimation: (elapsed) => {
      doubleClickStartAt = elapsed
      swimBurstStartAt = elapsed
      nextSwimBurstAt = Math.max(nextSwimBurstAt, elapsed + 2.2)
      return true
    },
    setDragging: (dragging, elapsed) => {
      if (isDragging === dragging) {
        return
      }

      isDragging = dragging

      if (dragging) {
        dragReleaseStartAt = Number.NEGATIVE_INFINITY
        swimBurstStartAt = elapsed
        nextSwimBurstAt = Math.max(nextSwimBurstAt, elapsed + 1.6)
        return
      }

      dragReleaseStartAt = elapsed
    },
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

function createBellGeometry(): THREE.BufferGeometry {
  const radialSegments = 72
  const verticalSegments = 18
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const topColor = new THREE.Color(0xb8ecff)
  const rimColor = new THREE.Color(0x5aa9e8)
  const glowColor = new THREE.Color(0xe5f8ff)

  for (let yIndex = 0; yIndex <= verticalSegments; yIndex += 1) {
    const v = yIndex / verticalSegments
    const eased = 1 - Math.pow(1 - v, 1.72)
    const baseRadius = 0.055 + Math.pow(Math.sin(v * Math.PI * 0.5), 0.78) * 0.54
    const shoulder = Math.sin(v * Math.PI) * 0.085
    const y = 0.5 - eased * 0.58 + shoulder
    const rimInfluence = Math.pow(v, 5)

    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const u = radialIndex / radialSegments
      const angle = u * Math.PI * 2
      const scallop = Math.sin(angle * 8) * 0.018 * rimInfluence
      const softIrregularity = Math.sin(angle * 5 + v * 2.2) * 0.008 * Math.pow(v, 2.2)
      const radius = baseRadius + scallop + softIrregularity
      const vertexY = y + Math.sin(angle * 8 + 0.6) * 0.012 * rimInfluence

      positions.push(Math.cos(angle) * radius * 1.08, vertexY, Math.sin(angle) * radius)

      const color = topColor.clone().lerp(rimColor, Math.pow(v, 1.35))
      color.lerp(glowColor, Math.max(0, 1 - Math.abs(v - 0.36) / 0.42) * 0.22)
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

function createBellDetails(): { root: THREE.Group } {
  const root = new THREE.Group()
  root.name = 'Jellyfish under-bell details'

  const spokeMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xcff8ff,
    depthWrite: false,
    opacity: 0.16,
    transparent: true
  })

  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2
    const positions: number[] = []

    for (let step = 0; step <= 5; step += 1) {
      const t = step / 5
      const radius = 0.12 + t * 0.31
      const droop = Math.sin(t * Math.PI) * 0.035
      positions.push(
        Math.cos(angle) * radius,
        -0.065 - droop,
        Math.sin(angle) * radius
      )
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    )

    const spoke = new THREE.Line(geometry, spokeMaterial)
    spoke.name = 'Jellyfish under-bell spoke'
    root.add(spoke)
  }

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.23, 0.01, 8, 36),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffd7f4,
      depthWrite: false,
      opacity: 0.12,
      transparent: true
    })
  )
  innerRing.name = 'Jellyfish soft inner ring'
  innerRing.rotation.x = Math.PI / 2
  innerRing.position.y = -0.055
  root.add(innerRing)

  return { root }
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
  waveSway: number
): void {
  const { angle, baseRadius, length, phase, positions, segmentCount, waveScale } = tentacle
  const baseX = Math.cos(angle) * baseRadius * (1.02 - (pulse - 1) * 0.65)
  const baseZ = Math.sin(angle) * baseRadius * (1.02 - (pulse - 1) * 0.65)

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    const t = segment / segmentCount
    const falloff = t * t
    const wave =
      Math.sin(elapsed * (1.18 + energy * 0.08) + phase + t * 4.45) *
      0.058 *
      energy *
      waveScale *
      falloff
    const crossWave =
      (Math.cos(elapsed * 0.88 + phase * 1.3 + t * 4.1) * 0.038 +
        waveSway * 0.048) *
      energy *
      waveScale *
      falloff
    const taperRadius = baseRadius * (1 - t * 0.58)
    const index = segment * 3

    positions[index] = Math.cos(angle) * taperRadius + Math.cos(angle + Math.PI / 2) * wave
    positions[index + 1] = 0.04 - length * t + Math.sin(elapsed * 1.28 + phase) * 0.024 * t
    positions[index + 2] = Math.sin(angle) * taperRadius + Math.sin(angle + Math.PI / 2) * wave + crossWave
  }

  positions[0] = baseX
  positions[2] = baseZ
  tentacle.geometry.attributes.position.needsUpdate = true
}
