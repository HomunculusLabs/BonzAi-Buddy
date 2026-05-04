import * as THREE from 'three'
import {
  clusteredTentacleAngle,
  createRibbonIndices,
  createTentacleCenters
} from './jellyfish-geometry'
import type { JellyfishTentacle } from './jellyfish-types'

const PRIMARY_TENTACLE_COUNT = 12
const ORAL_ARM_COUNT = 6
const SECONDARY_FILAMENT_COUNT = 22
const TENTACLE_SEGMENTS = 24

const ribbonTangentScratch = new THREE.Vector3()
const ribbonViewScratch = new THREE.Vector3()
const ribbonSideScratch = new THREE.Vector3()
const filamentCenterScratch = new THREE.Vector3()

interface JellyfishTentacleMaterials {
  filamentMaterial: THREE.LineBasicMaterial
  heroTentacleMaterial: THREE.MeshBasicMaterial
  oralArmMaterial: THREE.MeshBasicMaterial
  tentacleRibbonMaterial: THREE.MeshBasicMaterial
}

export function createJellyfishTentacles(input: {
  oralCoreGroup: THREE.Group
  tentacleRoot: THREE.Group
  materials: JellyfishTentacleMaterials
}): JellyfishTentacle[] {
  const { oralCoreGroup, tentacleRoot, materials } = input
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

    const isHero = index % 4 === 0
    const ribbon = new THREE.Mesh(geometry, isHero ? materials.heroTentacleMaterial : materials.tentacleRibbonMaterial)
    ribbon.name = isHero ? 'Jellyfish hero tendril' : 'Jellyfish translucent ribbon tentacle'
    ribbon.renderOrder = isHero ? 16 : 14
    tentacleRoot.add(ribbon)

    tentacles.push({
      angle,
      baseRadius: index % 4 === 0 ? 0.13 : index % 2 === 0 ? 0.25 : 0.37,
      centers,
      geometry,
      length: index % 4 === 0 ? 1.82 : index % 7 === 0 ? 1.58 : index % 3 === 0 ? 1.18 : 0.9,
      phase: index * 0.82,
      positions,
      segmentCount,
      style: isHero ? 'hero' : 'ribbon',
      tipWidth: isHero ? 0.0045 : 0.0025 + (index % 3) * 0.001,
      waveScale: isHero ? 0.74 : 0.48 + (index % 4) * 0.07,
      width: isHero ? 0.032 : 0.017 + (index % 4) * 0.0045
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

    const oralArm = new THREE.Mesh(geometry, materials.oralArmMaterial)
    oralArm.name = 'Jellyfish curled oral arm'
    oralArm.renderOrder = 20
    oralCoreGroup.add(oralArm)

    tentacles.push({
      angle,
      baseRadius: 0.025 + (index % 3) * 0.028,
      centers,
      geometry,
      length: index % 5 === 0 ? 0.76 : 0.5 + (index % 4) * 0.1,
      phase: index * 1.12 + 0.7,
      positions,
      segmentCount,
      style: 'oralArm',
      tipWidth: 0.038 + (index % 3) * 0.006,
      waveScale: 0.68 + (index % 3) * 0.07,
      width: 0.1 + (index % 3) * 0.018
    })
  }

  for (let index = 0; index < SECONDARY_FILAMENT_COUNT; index += 1) {
    const angle = clusteredTentacleAngle(index, SECONDARY_FILAMENT_COUNT, 4, 0.42, 0.28)
    const segmentCount = Math.round(TENTACLE_SEGMENTS * 0.7)
    const centers = createTentacleCenters(segmentCount)
    const positions = new Float32Array((segmentCount + 1) * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.78, 0), 1.65)

    const line = new THREE.Line(geometry, materials.filamentMaterial)
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

  return tentacles
}

export function updateJellyfishTentacles(
  tentacles: JellyfishTentacle[],
  elapsed: number,
  pulse: number,
  energy: number,
  waveSway: number,
  cameraLocalPosition: THREE.Vector3
): void {
  for (const tentacle of tentacles) {
    updateTentacle(
      tentacle,
      elapsed,
      pulse,
      energy,
      waveSway,
      cameraLocalPosition
    )
  }
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
    tentacle.style === 'oralArm' ? 0.12 : tentacle.style === 'hero' ? 0.26 : tentacle.style === 'ribbon' ? 0.22 : 0.32
  const laggedElapsed = elapsed - lagSeconds * (0.7 + energy * 0.08)
  const laggedPulse =
    1 +
    (pulse - 1) *
      (tentacle.style === 'oralArm' ? 0.78 : tentacle.style === 'hero' ? 0.5 : tentacle.style === 'ribbon' ? 0.56 : 0.38)

  if (tentacle.style === 'ribbon' || tentacle.style === 'oralArm' || tentacle.style === 'hero') {
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
      tentacle.style === 'oralArm' ? Math.pow(t, 0.9) : tentacle.style === 'hero' ? Math.pow(t, 1.12) : Math.pow(t, 1.25)
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
    t * (tentacle.style === 'oralArm' ? 0.08 : tentacle.style === 'hero' ? 0.2 : tentacle.style === 'ribbon' ? 0.16 : 0.22)
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
  const taperRadius = baseRadius * (1 - t * (tentacle.style === 'oralArm' ? 0.28 : tentacle.style === 'hero' ? 0.46 : 0.58))
  const outwardArc =
    tentacle.style === 'oralArm'
      ? Math.sin(phase * 1.7) * 0.035 * Math.sin(t * Math.PI)
      : tentacle.style === 'hero'
        ? Math.sin(phase * 0.9) * 0.15 * Math.sin(t * Math.PI * 0.78)
        : tentacle.style === 'ribbon'
          ? Math.sin(phase * 0.9) * 0.075 * Math.sin(t * Math.PI * 0.82)
          : Math.sin(phase * 0.8) * 0.11 * Math.sin(t * Math.PI * 0.72)
  const currentAmount =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 1.18 + phase) * 0.06 * Math.sin(t * Math.PI)
      : tentacle.style === 'hero'
        ? Math.sin(t * Math.PI * 1.08 + phase * 0.65) * 0.11 * Math.pow(t, 1.08)
        : tentacle.style === 'ribbon'
          ? Math.sin(t * Math.PI * 1.18 + phase * 0.7) * 0.064 * Math.pow(t, 1.2)
          : Math.sin(t * Math.PI * 1.02 + phase * 0.5) * 0.085 * Math.pow(t, 1.4)
  const curl =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 1.7 + phase) * 0.07 * Math.sin(t * Math.PI)
      : 0
  const startY =
    tentacle.style === 'oralArm'
      ? -0.055 + Math.sin(phase) * 0.026
      : tentacle.style === 'hero'
        ? -0.006 + Math.sin(phase * 0.7) * 0.042
        : tentacle.style === 'ribbon'
          ? 0.0 + Math.sin(phase * 0.7) * 0.035
          : -0.012 + Math.sin(phase * 0.9) * 0.04
  const oralFold =
    tentacle.style === 'oralArm'
      ? Math.sin(t * Math.PI * 1.28 + phase * 0.6) * 0.036 * t
      : 0
  const sideMotion = wave + curl + currentAmount
  const radialRadius = taperRadius + outwardArc

  const horizontalScale = 1.02 - (pulse - 1) * 0.65

  return target.set(
    (Math.cos(angle) * radialRadius + Math.cos(angle + Math.PI / 2) * sideMotion) * horizontalScale,
    startY - length * t + Math.sin(localElapsed * 0.9 + phase) * 0.02 * t + oralFold,
    (Math.sin(angle) * radialRadius + Math.sin(angle + Math.PI / 2) * sideMotion + crossWave) * horizontalScale
  )
}
