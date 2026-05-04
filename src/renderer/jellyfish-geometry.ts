import * as THREE from 'three'

export function createBellGeometry(): THREE.BufferGeometry {
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
    const crownRoundness = Math.sin(v * Math.PI) * 0.028
    const baseRadius = 0.09 + Math.pow(Math.sin(v * Math.PI * 0.52), 1.18) * 0.46 + crownRoundness
    const shoulder = Math.sin(v * Math.PI) * 0.145
    const rimInfluence = Math.pow(v, 4.0)
    const y = 0.45 - eased * 0.49 + shoulder - rimInfluence * 0.082

    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const u = radialIndex / radialSegments
      const angle = u * Math.PI * 2
      const scallop = Math.sin(angle * 10 + Math.sin(angle * 2.3) * 0.45) * 0.022 * rimInfluence
      const asymmetry = Math.sin(angle * 2.1 + 0.35) * 0.026 * Math.pow(v, 1.45)
      const softIrregularity =
        (Math.sin(angle * 4.7 + v * 2.2) * 0.012 +
          Math.sin(angle * 7.3 + 1.1) * 0.007) *
        Math.pow(v, 1.9)
      const radius = baseRadius + scallop + asymmetry + softIrregularity
      const vertexY =
        y +
        Math.sin(angle * 8.4 + 0.6) * 0.015 * rimInfluence +
        Math.sin(angle * 3.2 + 1.4) * 0.011 * Math.pow(v, 2.2)

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

export function createScallopedRimGeometry(): THREE.BufferGeometry {
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
    const scallop = Math.sin(angle * 10 + Math.sin(angle * 2.2) * 0.5) * 0.018 + Math.sin(angle * 4.3) * 0.01
    const y = Math.sin(angle * 8.7 + 0.4) * 0.011 + Math.sin(angle * 2.4) * 0.012

    for (const edge of [0, 1]) {
      const radius = (edge === 0 ? innerRadius : outerRadius) + scallop * edge
      const partialFold = Math.max(0.25, 0.72 + Math.sin(angle * 3.4 + 0.8) * 0.28)
      const droop = edge === 0 ? 0.024 : (0.078 + Math.sin(angle * 5.5) * 0.024) * partialFold
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

export function createBellDetails(spokeMaterial: THREE.LineBasicMaterial): { root: THREE.Group } {
  const root = new THREE.Group()
  root.name = 'Jellyfish faint radial veins'

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


export function createUndersideFoldGeometry(index: number): THREE.BufferGeometry {
  const segmentCount = 10
  const positions: number[] = []
  const indices: number[] = []
  const foldPhase = index * 1.37
  const length = 0.18 + (index % 3) * 0.035
  const baseWidth = 0.07 + (index % 2) * 0.018
  const tipWidth = 0.018 + (index % 3) * 0.004

  for (let segment = 0; segment <= segmentCount; segment += 1) {
    const t = segment / segmentCount
    const width = THREE.MathUtils.lerp(baseWidth, tipWidth, Math.pow(t, 0.82))
    const curl = Math.sin(t * Math.PI * 1.15 + foldPhase) * 0.025 * Math.sin(t * Math.PI)
    const y = -0.035 - length * t + Math.sin(t * Math.PI + foldPhase) * 0.012
    const z = curl

    positions.push(-width, y, z, width, y, z)
  }

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const leftA = segment * 2
    const rightA = leftA + 1
    const leftB = leftA + 2
    const rightB = leftA + 3
    indices.push(leftA, leftB, rightA, rightA, leftB, rightB)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function clusteredTentacleAngle(
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

export function createTentacleCenters(segmentCount: number): THREE.Vector3[] {
  return Array.from({ length: segmentCount + 1 }, () => new THREE.Vector3())
}

export function createRibbonIndices(segmentCount: number): number[] {
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
