import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRM, VRMUtils } from '@pixiv/three-vrm'
import {
  VRMAnimation,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip
} from '@pixiv/three-vrm-animation'
import { createAuthoredVrmClips } from './vrm-animation-clips'
import { loadMixamoAnimationClip } from './mixamo-animation-loader'

export interface ResolvedStageAnimationSet {
  hasLookAtTracks: boolean
  idle: THREE.AnimationClip
  emotes: THREE.AnimationClip[]
  statusMessage: string
}

type StageAnimationSource = 'fallback' | 'mixamo-fbx' | 'vrma'

interface OptionalStageClipResult {
  clip: THREE.AnimationClip | null
  source: StageAnimationSource
}

const ANIMATION_RUNTIME_DIRECTORY = './static/animations'
const ANIMATION_PUBLIC_DIRECTORY = 'public/static/animations'
const VRMA_IDLE_RUNTIME_PATH = `${ANIMATION_RUNTIME_DIRECTORY}/idle.vrma`
const VRMA_WAVE_RUNTIME_PATH = `${ANIMATION_RUNTIME_DIRECTORY}/wave.vrma`
const MIXAMO_IDLE_RUNTIME_PATH = `${ANIMATION_RUNTIME_DIRECTORY}/idle.fbx`
const MIXAMO_WAVE_RUNTIME_PATH = `${ANIMATION_RUNTIME_DIRECTORY}/wave.fbx`
const LOOK_AT_PROXY_NAME = 'VRMLookAtQuaternionProxy'

export async function resolveStageAnimationSet(
  loader: GLTFLoader,
  vrm: VRM
): Promise<ResolvedStageAnimationSet> {
  const fallbackClips = createAuthoredVrmClips(vrm)
  const lookAtTrackName = ensureLookAtQuaternionProxy(vrm)

  const [idleAsset, waveAsset] = await Promise.all([
    loadPreferredStageClip(loader, vrm, {
      clipName: 'idle',
      fbxPath: MIXAMO_IDLE_RUNTIME_PATH,
      upperBodyOnly: false,
      vrmaPath: VRMA_IDLE_RUNTIME_PATH
    }),
    loadPreferredStageClip(loader, vrm, {
      clipName: 'wave',
      fbxPath: MIXAMO_WAVE_RUNTIME_PATH,
      upperBodyOnly: true,
      vrmaPath: VRMA_WAVE_RUNTIME_PATH
    })
  ])

  const idle = idleAsset.clip ?? fallbackClips.idle
  const preferredWave =
    waveAsset.clip ??
    fallbackClips.emotes.find((clip) => clip.name === 'wave') ??
    null
  const emotes = [
    ...[preferredWave].filter((clip): clip is THREE.AnimationClip => clip !== null),
    ...fallbackClips.emotes.filter((clip) => clip.name !== 'wave')
  ]

  const clips = [idle, ...emotes]
  const hasLookAtTracks = clips.some((clip) =>
    clip.tracks.some((track) => track.name === lookAtTrackName)
  )

  return {
    hasLookAtTracks,
    idle,
    emotes,
    statusMessage: buildStatusMessage(idleAsset.source, waveAsset.source)
  }
}

function ensureLookAtQuaternionProxy(vrm: VRM): string {
  if (!vrm.lookAt) {
    return `${LOOK_AT_PROXY_NAME}.quaternion`
  }

  const existingProxy = vrm.scene.children.find(
    (child): child is VRMLookAtQuaternionProxy =>
      child instanceof VRMLookAtQuaternionProxy
  )

  if (existingProxy) {
    if (!existingProxy.name) {
      existingProxy.name = LOOK_AT_PROXY_NAME
    }

    return `${existingProxy.name}.quaternion`
  }

  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
  proxy.name = LOOK_AT_PROXY_NAME
  vrm.scene.add(proxy)

  return `${proxy.name}.quaternion`
}

async function loadPreferredStageClip(
  loader: GLTFLoader,
  vrm: VRM,
  options: {
    clipName: string
    fbxPath: string
    upperBodyOnly?: boolean
    vrmaPath: string
  }
): Promise<OptionalStageClipResult> {
  const vrmaClip = await loadOptionalVrmaClip(
    loader,
    vrm,
    options.vrmaPath,
    options.clipName
  )

  if (vrmaClip.clip) {
    return vrmaClip
  }

  const mixamoClip = await loadOptionalMixamoClip(
    vrm,
    options.fbxPath,
    options.clipName,
    { upperBodyOnly: options.upperBodyOnly ?? false }
  )

  if (mixamoClip.clip) {
    return mixamoClip
  }

  return { clip: null, source: 'fallback' }
}

async function loadOptionalVrmaClip(
  loader: GLTFLoader,
  vrm: VRM,
  assetPath: string,
  clipName: string
): Promise<OptionalStageClipResult> {
  try {
    const gltf = await loader.loadAsync(assetPath)

    try {
      const vrmAnimation = (gltf.userData as { vrmAnimations?: VRMAnimation[] })
        .vrmAnimations?.[0]

      if (!vrmAnimation) {
        console.warn(`VRMA asset did not expose a VRM animation: ${assetPath}`)
        return { clip: null, source: 'fallback' }
      }

      const clip = createVRMAnimationClip(vrmAnimation, vrm)
      clip.name = clipName

      return { clip, source: 'vrma' }
    } finally {
      gltf.scene.removeFromParent()
      VRMUtils.deepDispose(gltf.scene)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.info(`VRMA asset unavailable at ${assetPath}; trying Mixamo FBX.`, reason)
    return { clip: null, source: 'fallback' }
  }
}

async function loadOptionalMixamoClip(
  vrm: VRM,
  assetPath: string,
  clipName: string,
  options: { upperBodyOnly: boolean }
): Promise<OptionalStageClipResult> {
  try {
    const clip = await loadMixamoAnimationClip(assetPath, vrm, clipName, options)
    return { clip, source: 'mixamo-fbx' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.info(`Mixamo FBX asset unavailable at ${assetPath}; using fallback clip.`, reason)
    return { clip: null, source: 'fallback' }
  }
}

function buildStatusMessage(
  idleSource: StageAnimationSource,
  waveSource: StageAnimationSource
): string {
  const summary = `VRM ready — active motions: idle = ${sourceLabel(idleSource)}, wave = ${sourceLabel(waveSource)}.`

  if (idleSource === 'fallback' || waveSource === 'fallback') {
    return `${summary} ${animationPlacementHint()}`
  }

  return summary
}

function sourceLabel(source: StageAnimationSource): string {
  switch (source) {
    case 'vrma':
      return 'real VRMA'
    case 'mixamo-fbx':
      return 'Mixamo FBX'
    case 'fallback':
    default:
      return 'built-in fallback'
  }
}

function animationPlacementHint(): string {
  return [
    `Bonzi prefers ${ANIMATION_PUBLIC_DIRECTORY}/idle.vrma or idle.fbx, and ${ANIMATION_PUBLIC_DIRECTORY}/wave.vrma or wave.fbx.`,
    `They are served at runtime as ${VRMA_IDLE_RUNTIME_PATH}, ${MIXAMO_IDLE_RUNTIME_PATH}, ${VRMA_WAVE_RUNTIME_PATH}, and ${MIXAMO_WAVE_RUNTIME_PATH}.`
  ].join(' ')
}
