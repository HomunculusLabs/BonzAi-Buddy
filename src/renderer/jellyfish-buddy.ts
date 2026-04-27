import * as THREE from 'three'
import { MIN_SUBJECT_HEIGHT, type VrmSubjectMetrics } from './vrm-stage-scene'

interface JellyfishTentacle {
  angle: number
  baseRadius: number
  geometry: THREE.BufferGeometry
  length: number
  phase: number
  positions: Float32Array
  segmentCount: number
}

export interface JellyfishBuddyHandle {
  metrics: VrmSubjectMetrics
  root: THREE.Group
  update(delta: number, elapsed: number, pointerNdc: THREE.Vector2): void
  dispose(): void
}

const TENTACLE_COUNT = 18
const TENTACLE_SEGMENTS = 28

export function createJellyfishBuddy(scene: THREE.Scene): JellyfishBuddyHandle {
  const root = new THREE.Group()
  root.name = 'Jellyfish Buddy'
  root.position.set(0, 0.92, 0)

  const bellPivot = new THREE.Group()
  bellPivot.name = 'Jellyfish bell pivot'
  root.add(bellPivot)

  const bellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x93dcff,
    depthWrite: false,
    emissive: 0x2a6fff,
    emissiveIntensity: 0.34,
    metalness: 0,
    opacity: 0.46,
    roughness: 0.22,
    side: THREE.DoubleSide,
    transparent: true,
    transmission: 0.22
  })

  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.72),
    bellMaterial
  )
  bell.name = 'Jellyfish translucent bell'
  bell.scale.set(1.08, 0.62, 1.08)
  bell.position.y = 0.22
  bellPivot.add(bell)

  const skirt = new THREE.Mesh(
    new THREE.TorusGeometry(0.43, 0.024, 10, 48),
    new THREE.MeshBasicMaterial({
      color: 0xb7efff,
      depthWrite: false,
      opacity: 0.34,
      transparent: true
    })
  )
  skirt.name = 'Jellyfish glowing skirt'
  skirt.rotation.x = Math.PI / 2
  skirt.position.y = -0.12
  bellPivot.add(skirt)

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 16),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x7c9cff,
      depthWrite: false,
      opacity: 0.2,
      transparent: true
    })
  )
  coreGlow.name = 'Jellyfish soft core glow'
  coreGlow.scale.set(1.1, 0.75, 1.1)
  coreGlow.position.y = 0.08
  bellPivot.add(coreGlow)

  const glowLight = new THREE.PointLight(0x7ddfff, 1.2, 3.2, 2.2)
  glowLight.name = 'Jellyfish glow light'
  glowLight.position.set(0, 0.02, 0.1)
  root.add(glowLight)

  const tentacleMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0x9eeaff,
    depthWrite: false,
    opacity: 0.7,
    transparent: true
  })
  const tendrilMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xd8b9ff,
    depthWrite: false,
    opacity: 0.48,
    transparent: true
  })

  const tentacles: JellyfishTentacle[] = []

  for (let index = 0; index < TENTACLE_COUNT; index += 1) {
    const angle = (index / TENTACLE_COUNT) * Math.PI * 2
    const segmentCount = TENTACLE_SEGMENTS
    const positions = new Float32Array((segmentCount + 1) * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const isLongTendril = index % 3 === 0
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, -((isLongTendril ? 1.78 : 1.28) * 0.5), 0),
      (isLongTendril ? 1.78 : 1.28) + 0.48
    )

    const line = new THREE.Line(geometry, isLongTendril ? tendrilMaterial : tentacleMaterial)
    line.name = isLongTendril ? 'Jellyfish long tendril' : 'Jellyfish tentacle'
    root.add(line)

    tentacles.push({
      angle,
      baseRadius: isLongTendril ? 0.24 : 0.36,
      geometry,
      length: isLongTendril ? 1.78 : 1.28,
      phase: index * 0.73,
      positions,
      segmentCount
    })
  }

  const metrics: VrmSubjectMetrics = {
    center: new THREE.Vector3(0, 0.42, 0),
    rootHeight: Math.max(1.85, MIN_SUBJECT_HEIGHT),
    size: new THREE.Vector3(1.24, 1.95, 1.04)
  }

  scene.add(root)

  const update = (delta: number, elapsed: number, pointerNdc: THREE.Vector2): void => {
    const swim = Math.sin(elapsed * 2.35)
    const pulse = 1 + swim * 0.045
    const driftX = pointerNdc.x * 0.045 + Math.sin(elapsed * 0.72) * 0.035
    const driftZ = Math.cos(elapsed * 0.58) * 0.025

    root.position.x = THREE.MathUtils.lerp(root.position.x, driftX, 1 - Math.exp(-delta * 2.6))
    root.position.y = 0.92 + Math.sin(elapsed * 1.35) * 0.075
    root.position.z = THREE.MathUtils.lerp(root.position.z, driftZ, 1 - Math.exp(-delta * 2.2))
    root.rotation.y += delta * 0.18
    root.rotation.z = THREE.MathUtils.lerp(root.rotation.z, -pointerNdc.x * 0.06, 1 - Math.exp(-delta * 3.5))

    bellPivot.scale.set(1 / pulse, pulse, 1 / pulse)
    skirt.scale.set(1 + swim * 0.07, 1, 1 + swim * 0.07)
    coreGlow.scale.set(1.1 + swim * 0.04, 0.75 + swim * 0.035, 1.1 + swim * 0.04)
    glowLight.intensity = 1.1 + Math.max(0, swim) * 0.38

    for (const tentacle of tentacles) {
      updateTentacle(tentacle, elapsed, pulse)
    }
  }

  update(0, 0, new THREE.Vector2())

  return {
    metrics,
    root,
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

function updateTentacle(
  tentacle: JellyfishTentacle,
  elapsed: number,
  pulse: number
): void {
  const { angle, baseRadius, length, phase, positions, segmentCount } = tentacle
  const baseX = Math.cos(angle) * baseRadius * (1.02 - (pulse - 1) * 0.8)
  const baseZ = Math.sin(angle) * baseRadius * (1.02 - (pulse - 1) * 0.8)

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    const t = segment / segmentCount
    const falloff = t * t
    const wave = Math.sin(elapsed * 2.6 + phase + t * 6.4) * 0.085 * falloff
    const crossWave = Math.cos(elapsed * 2.1 + phase * 1.3 + t * 5.2) * 0.055 * falloff
    const taperRadius = baseRadius * (1 - t * 0.62)
    const index = segment * 3

    positions[index] = Math.cos(angle) * taperRadius + Math.cos(angle + Math.PI / 2) * wave
    positions[index + 1] = -0.08 - length * t + Math.sin(elapsed * 3.4 + phase) * 0.04 * t
    positions[index + 2] = Math.sin(angle) * taperRadius + Math.sin(angle + Math.PI / 2) * wave + crossWave
  }

  positions[0] = baseX
  positions[2] = baseZ
  tentacle.geometry.attributes.position.needsUpdate = true
}
