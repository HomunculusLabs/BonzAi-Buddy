import * as THREE from 'three'
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

export interface AuthoredVrmClipSet {
  idle: THREE.AnimationClip
  emotes: THREE.AnimationClip[]
}

type HumanBoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]

type AnimationBoneKey =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand'

type EulerOffset = readonly [number, number, number]
type Pose = Partial<Record<AnimationBoneKey, EulerOffset>>

interface PoseFrame {
  at: number
  pose: Pose
}

interface BoneBinding {
  baseQuaternion: THREE.Quaternion
  trackName: string
}

type BoneBindings = Partial<Record<AnimationBoneKey, BoneBinding>>

const BONE_KEYS: AnimationBoneKey[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'rightShoulder',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand'
]

const BONE_CANDIDATES: Record<AnimationBoneKey, readonly HumanBoneName[]> = {
  hips: [VRMHumanBoneName.Hips],
  spine: [VRMHumanBoneName.Spine],
  chest: [VRMHumanBoneName.UpperChest, VRMHumanBoneName.Chest],
  neck: [VRMHumanBoneName.Neck],
  head: [VRMHumanBoneName.Head],
  leftShoulder: [VRMHumanBoneName.LeftShoulder],
  rightShoulder: [VRMHumanBoneName.RightShoulder],
  leftUpperArm: [VRMHumanBoneName.LeftUpperArm],
  rightUpperArm: [VRMHumanBoneName.RightUpperArm],
  leftLowerArm: [VRMHumanBoneName.LeftLowerArm],
  rightLowerArm: [VRMHumanBoneName.RightLowerArm],
  leftHand: [VRMHumanBoneName.LeftHand],
  rightHand: [VRMHumanBoneName.RightHand]
}

export function createAuthoredVrmClips(vrm: VRM): AuthoredVrmClipSet {
  const bindings = createBoneBindings(vrm)

  return {
    idle: createIdleClip(bindings),
    emotes: [createWaveClip(bindings), createHappyBounceClip(bindings)]
  }
}

function createBoneBindings(vrm: VRM): BoneBindings {
  const bindings: BoneBindings = {}

  for (const key of BONE_KEYS) {
    const node = getNormalizedBoneNode(vrm, BONE_CANDIDATES[key])

    if (!node) {
      continue
    }

    bindings[key] = {
      baseQuaternion: node.quaternion.clone(),
      trackName: `${node.uuid}.quaternion`
    }
  }

  return bindings
}

function getNormalizedBoneNode(
  vrm: VRM,
  candidates: readonly HumanBoneName[]
): THREE.Object3D | null {
  for (const candidate of candidates) {
    const node = vrm.humanoid.getNormalizedBoneNode(candidate)

    if (node) {
      return node
    }
  }

  return null
}

function createIdleClip(bindings: BoneBindings): THREE.AnimationClip {
  const relaxed = createRelaxedPose()

  return createClip('idle', 4.8, bindings, [
    { at: 0, pose: relaxed },
    {
      at: 0.25,
      pose: {
        ...relaxed,
        hips: angles(-4, 6, -1),
        spine: angles(3, 4, 1),
        chest: angles(8, 5, 3),
        neck: angles(-1, -4, -1),
        head: angles(3, -3, -2),
        leftShoulder: angles(4, 0, -11),
        rightShoulder: angles(5, 0, 13),
        leftUpperArm: angles(12, 8, -64),
        rightUpperArm: angles(8, -5, 58),
        leftLowerArm: angles(-20, 6, -11),
        rightLowerArm: angles(-17, -4, 8),
        leftHand: angles(4, 0, 8),
        rightHand: angles(1, 0, -4)
      }
    },
    {
      at: 0.5,
      pose: {
        ...relaxed,
        hips: angles(0, -5, 1),
        spine: angles(1, -4, -1),
        chest: angles(2, -5, -2),
        neck: angles(0, 3, 1),
        head: angles(1, 4, 2),
        leftShoulder: angles(2, 0, -13),
        rightShoulder: angles(2, 0, 10),
        leftUpperArm: angles(8, 5, -58),
        rightUpperArm: angles(10, -7, 64),
        leftLowerArm: angles(-17, 4, -8),
        rightLowerArm: angles(-20, -6, 12),
        leftHand: angles(1, 0, 3),
        rightHand: angles(4, 0, -8)
      }
    },
    {
      at: 0.75,
      pose: {
        ...relaxed,
        hips: angles(-3, 2, 1),
        spine: angles(3, 1, 2),
        chest: angles(7, 2, 3),
        neck: angles(-1, 0, 1),
        head: angles(2, 1, 2),
        leftShoulder: angles(4, 0, -13),
        rightShoulder: angles(3, 0, 11),
        leftUpperArm: angles(11, 6, -62),
        rightUpperArm: angles(9, -6, 60),
        leftLowerArm: angles(-19, 5, -9),
        rightLowerArm: angles(-18, -5, 10),
        leftHand: angles(3, 0, 7),
        rightHand: angles(2, 0, -5)
      }
    },
    { at: 1, pose: relaxed }
  ])
}

function createWaveClip(bindings: BoneBindings): THREE.AnimationClip {
  const relaxed = createRelaxedPose()

  return createClip('wave', 2.6, bindings, [
    { at: 0, pose: relaxed },
    {
      at: 0.16,
      pose: {
        ...relaxed,
        hips: angles(-3, 6, -1),
        spine: angles(4, 6, -2),
        chest: angles(8, 10, -3),
        leftUpperArm: angles(10, 5, -59),
        rightShoulder: angles(10, -8, 4),
        rightUpperArm: angles(38, -14, 18),
        rightLowerArm: angles(-78, -10, 14),
        rightHand: angles(10, 0, -18)
      }
    },
    {
      at: 0.34,
      pose: {
        ...relaxed,
        hips: angles(-2, 8, -1),
        spine: angles(4, 8, -3),
        chest: angles(10, 12, -4),
        leftUpperArm: angles(11, 5, -60),
        rightShoulder: angles(14, -12, 0),
        rightUpperArm: angles(52, -20, 12),
        rightLowerArm: angles(-96, -8, 18),
        rightHand: angles(18, 0, 28)
      }
    },
    {
      at: 0.5,
      pose: {
        ...relaxed,
        hips: angles(-2, 7, 0),
        spine: angles(4, 7, -1),
        chest: angles(10, 9, -1),
        leftUpperArm: angles(10, 5, -60),
        rightShoulder: angles(13, -10, 2),
        rightUpperArm: angles(48, -18, 16),
        rightLowerArm: angles(-92, -10, 16),
        rightHand: angles(18, 0, -26)
      }
    },
    {
      at: 0.68,
      pose: {
        ...relaxed,
        hips: angles(-2, 9, -1),
        spine: angles(4, 9, -3),
        chest: angles(10, 12, -4),
        leftUpperArm: angles(11, 5, -60),
        rightShoulder: angles(14, -12, 0),
        rightUpperArm: angles(53, -20, 11),
        rightLowerArm: angles(-96, -8, 18),
        rightHand: angles(18, 0, 26)
      }
    },
    {
      at: 0.84,
      pose: {
        ...relaxed,
        hips: angles(-2, 4, 0),
        spine: angles(3, 4, -1),
        chest: angles(7, 6, -2),
        rightShoulder: angles(8, -5, 8),
        rightUpperArm: angles(24, -10, 36),
        rightLowerArm: angles(-54, -8, 10),
        rightHand: angles(8, 0, -12)
      }
    },
    { at: 1, pose: relaxed }
  ])
}

function createHappyBounceClip(bindings: BoneBindings): THREE.AnimationClip {
  const relaxed = createRelaxedPose()

  return createClip('happy-bounce', 2.9, bindings, [
    { at: 0, pose: relaxed },
    {
      at: 0.18,
      pose: {
        ...relaxed,
        hips: angles(8, -10, -6),
        spine: angles(-4, -7, -4),
        chest: angles(10, -9, -7),
        leftShoulder: angles(8, 0, -9),
        rightShoulder: angles(7, 0, 15),
        leftUpperArm: angles(20, 14, -40),
        rightUpperArm: angles(18, -18, 46),
        leftLowerArm: angles(-44, 10, -8),
        rightLowerArm: angles(-48, -12, 10),
        leftHand: angles(6, 0, 10),
        rightHand: angles(6, 0, -12)
      }
    },
    {
      at: 0.34,
      pose: {
        ...relaxed,
        hips: angles(-6, 0, 0),
        spine: angles(5, 0, 0),
        chest: angles(-4, 0, 0),
        leftShoulder: angles(10, 0, -6),
        rightShoulder: angles(10, 0, 6),
        leftUpperArm: angles(28, 10, -30),
        rightUpperArm: angles(28, -10, 30),
        leftLowerArm: angles(-46, 10, -6),
        rightLowerArm: angles(-46, -10, 6),
        leftHand: angles(10, 0, 12),
        rightHand: angles(10, 0, -12)
      }
    },
    {
      at: 0.5,
      pose: {
        ...relaxed,
        hips: angles(8, 10, 6),
        spine: angles(-4, 7, 4),
        chest: angles(10, 9, 7),
        leftShoulder: angles(7, 0, -15),
        rightShoulder: angles(8, 0, 9),
        leftUpperArm: angles(18, 18, -46),
        rightUpperArm: angles(20, -14, 40),
        leftLowerArm: angles(-48, 12, -10),
        rightLowerArm: angles(-44, -10, 8),
        leftHand: angles(6, 0, 12),
        rightHand: angles(6, 0, -10)
      }
    },
    {
      at: 0.68,
      pose: {
        ...relaxed,
        hips: angles(-6, 0, 0),
        spine: angles(5, 0, 0),
        chest: angles(-4, 0, 0),
        leftShoulder: angles(10, 0, -6),
        rightShoulder: angles(10, 0, 6),
        leftUpperArm: angles(28, 8, -28),
        rightUpperArm: angles(28, -8, 28),
        leftLowerArm: angles(-46, 8, -4),
        rightLowerArm: angles(-46, -8, 4),
        leftHand: angles(10, 0, 10),
        rightHand: angles(10, 0, -10)
      }
    },
    {
      at: 0.84,
      pose: {
        ...relaxed,
        hips: angles(-4, 0, 0),
        spine: angles(3, 0, 0),
        chest: angles(12, 0, 0),
        leftShoulder: angles(12, 0, -4),
        rightShoulder: angles(12, 0, 4),
        leftUpperArm: angles(26, 8, -24),
        rightUpperArm: angles(26, -8, 24),
        leftLowerArm: angles(-52, 6, -4),
        rightLowerArm: angles(-52, -6, 4),
        leftHand: angles(12, 0, 8),
        rightHand: angles(12, 0, -8)
      }
    },
    { at: 1, pose: relaxed }
  ])
}

function createClip(
  name: string,
  duration: number,
  bindings: BoneBindings,
  frames: readonly PoseFrame[]
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []
  const times = frames.map((frame) => frame.at * duration)
  const animatedBones = new Set<AnimationBoneKey>()

  for (const frame of frames) {
    for (const key of Object.keys(frame.pose) as AnimationBoneKey[]) {
      animatedBones.add(key)
    }
  }

  for (const key of animatedBones) {
    const binding = bindings[key]

    if (!binding) {
      continue
    }

    const values: number[] = []

    for (const frame of frames) {
      const quaternion = composeQuaternion(binding.baseQuaternion, frame.pose[key])
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(binding.trackName, times, values))
  }

  return new THREE.AnimationClip(name, duration, tracks).optimize()
}

function composeQuaternion(
  baseQuaternion: THREE.Quaternion,
  offset: EulerOffset | undefined
): THREE.Quaternion {
  const quaternion = baseQuaternion.clone()

  if (!offset) {
    return quaternion
  }

  const offsetQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(offset[0], offset[1], offset[2], 'YXZ')
  )

  return quaternion.multiply(offsetQuaternion)
}

function createRelaxedPose(): Pose {
  return {
    hips: angles(-2, 4, 0),
    spine: angles(2, 2, 1),
    chest: angles(5, 3, 2),
    neck: angles(-1, -2, 0),
    head: angles(2, -1, 1),
    leftShoulder: angles(3, 0, -12),
    rightShoulder: angles(3, 0, 12),
    leftUpperArm: angles(9, 6, -61),
    rightUpperArm: angles(9, -6, 61),
    leftLowerArm: angles(-18, 5, -10),
    rightLowerArm: angles(-18, -5, 10),
    leftHand: angles(2, 0, 6),
    rightHand: angles(2, 0, -6)
  }
}

function angles(x: number, y: number, z: number): EulerOffset {
  return [
    THREE.MathUtils.degToRad(x),
    THREE.MathUtils.degToRad(y),
    THREE.MathUtils.degToRad(z)
  ]
}
