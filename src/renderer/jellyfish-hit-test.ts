import * as THREE from 'three'

export function hitTestJellyfish(root: THREE.Object3D, raycaster: THREE.Raycaster): boolean {
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
