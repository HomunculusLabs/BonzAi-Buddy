import * as THREE from 'three'

export const MIN_SUBJECT_HEIGHT = 1.45

const MAX_PIXEL_RATIO = 2

export interface VrmSubjectMetrics {
  center: THREE.Vector3
  rootHeight: number
  size: THREE.Vector3
}

export interface VrmStageSceneContext {
  camera: THREE.PerspectiveCamera
  frameSubject: (metrics: VrmSubjectMetrics | null) => void
  pointerNdc: THREE.Vector2
  pointerTarget: THREE.Object3D
  render: () => void
  renderer: THREE.WebGLRenderer
  resizeRenderer: () => void
  scene: THREE.Scene
  updatePointerTarget: (delta: number) => void
  dispose: () => void
}

export function createVrmStageScene(canvas: HTMLCanvasElement): VrmStageSceneContext {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  })
  const pointerNdc = new THREE.Vector2(0, 0.08)
  const desiredPointerNdc = new THREE.Vector2(0, 0.08)
  const pointerTarget = new THREE.Object3D()
  const cameraTarget = new THREE.Vector3(0, 1.25, 0)
  const desiredLookTarget = new THREE.Vector3(0, 1.35, 0)
  const lights = createLights()

  let currentMetrics: VrmSubjectMetrics | null = null

  const resizeObserver = new ResizeObserver(() => {
    resizeRenderer()
    frameSubject(currentMetrics)
  })

  scene.add(pointerTarget)
  scene.add(lights.hemisphere, lights.key, lights.rim)

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
  frameSubject(null)

  return {
    camera,
    frameSubject,
    pointerNdc,
    pointerTarget,
    render,
    renderer,
    resizeRenderer,
    scene,
    updatePointerTarget,
    dispose
  }

  function frameSubject(metrics: VrmSubjectMetrics | null): void {
    currentMetrics = metrics

    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)

    camera.aspect = width / height
    camera.updateProjectionMatrix()

    if (!metrics) {
      cameraTarget.set(0, 1.25, 0)
      camera.position.set(0, 1.35, 4.2)
      camera.lookAt(cameraTarget)
      pointerTarget.position.copy(cameraTarget)
      return
    }

    const { center: subjectCenter, rootHeight, size: subjectSize } = metrics
    const focusY = subjectCenter.y + rootHeight * 0.28
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5)
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect)
    const fitHeightDistance = (rootHeight * 0.72) / Math.tan(halfVerticalFov)
    const fitWidthDistance =
      (Math.max(subjectSize.x, 0.75) * 0.78) / Math.tan(halfHorizontalFov)
    const distance = Math.max(fitHeightDistance, fitWidthDistance) + subjectSize.z * 1.28

    cameraTarget.set(subjectCenter.x, focusY, subjectCenter.z)
    camera.position.set(
      subjectCenter.x + 0.04,
      subjectCenter.y + rootHeight * 0.56,
      subjectCenter.z + distance
    )
    camera.lookAt(cameraTarget)

    lights.key.position.set(
      subjectCenter.x + rootHeight * 0.55,
      subjectCenter.y + rootHeight * 1.15,
      subjectCenter.z + distance * 0.85
    )
    lights.rim.position.set(
      subjectCenter.x - rootHeight * 0.75,
      subjectCenter.y + rootHeight * 0.95,
      subjectCenter.z - distance * 0.55
    )

    pointerTarget.position.set(
      cameraTarget.x,
      cameraTarget.y + rootHeight * 0.12,
      camera.position.z - rootHeight * 0.32
    )
  }

  function updatePointerTarget(delta: number): void {
    const rootHeight = currentMetrics?.rootHeight ?? MIN_SUBJECT_HEIGHT
    const lateralRange = rootHeight * 0.18
    const verticalRange = rootHeight * 0.12

    pointerNdc.lerp(desiredPointerNdc, 1 - Math.exp(-delta * 10))
    desiredLookTarget.set(
      cameraTarget.x + pointerNdc.x * lateralRange,
      cameraTarget.y - rootHeight * 0.1 + pointerNdc.y * verticalRange,
      camera.position.z - rootHeight * 0.34
    )

    pointerTarget.position.lerp(desiredLookTarget, 1 - Math.exp(-delta * 12))
  }

  function resizeRenderer(): void {
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function render(): void {
    renderer.render(scene, camera)
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
    resizeObserver.disconnect()
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    window.removeEventListener('resize', resizeRenderer)
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
