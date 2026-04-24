import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

type HumanBoneName = (typeof VRMHumanBoneName)[keyof typeof VRMHumanBoneName]

const MIXAMO_VRM_RIG_MAP: Partial<Record<string, HumanBoneName>> = {
  mixamorigHips: VRMHumanBoneName.Hips,
  mixamorigSpine: VRMHumanBoneName.Spine,
  mixamorigSpine1: VRMHumanBoneName.Chest,
  mixamorigSpine2: VRMHumanBoneName.UpperChest,
  mixamorigNeck: VRMHumanBoneName.Neck,
  mixamorigHead: VRMHumanBoneName.Head,
  mixamorigLeftShoulder: VRMHumanBoneName.LeftShoulder,
  mixamorigLeftArm: VRMHumanBoneName.LeftUpperArm,
  mixamorigLeftForeArm: VRMHumanBoneName.LeftLowerArm,
  mixamorigLeftHand: VRMHumanBoneName.LeftHand,
  mixamorigLeftHandThumb1: VRMHumanBoneName.LeftThumbMetacarpal,
  mixamorigLeftHandThumb2: VRMHumanBoneName.LeftThumbProximal,
  mixamorigLeftHandThumb3: VRMHumanBoneName.LeftThumbDistal,
  mixamorigLeftHandIndex1: VRMHumanBoneName.LeftIndexProximal,
  mixamorigLeftHandIndex2: VRMHumanBoneName.LeftIndexIntermediate,
  mixamorigLeftHandIndex3: VRMHumanBoneName.LeftIndexDistal,
  mixamorigLeftHandMiddle1: VRMHumanBoneName.LeftMiddleProximal,
  mixamorigLeftHandMiddle2: VRMHumanBoneName.LeftMiddleIntermediate,
  mixamorigLeftHandMiddle3: VRMHumanBoneName.LeftMiddleDistal,
  mixamorigLeftHandRing1: VRMHumanBoneName.LeftRingProximal,
  mixamorigLeftHandRing2: VRMHumanBoneName.LeftRingIntermediate,
  mixamorigLeftHandRing3: VRMHumanBoneName.LeftRingDistal,
  mixamorigLeftHandPinky1: VRMHumanBoneName.LeftLittleProximal,
  mixamorigLeftHandPinky2: VRMHumanBoneName.LeftLittleIntermediate,
  mixamorigLeftHandPinky3: VRMHumanBoneName.LeftLittleDistal,
  mixamorigRightShoulder: VRMHumanBoneName.RightShoulder,
  mixamorigRightArm: VRMHumanBoneName.RightUpperArm,
  mixamorigRightForeArm: VRMHumanBoneName.RightLowerArm,
  mixamorigRightHand: VRMHumanBoneName.RightHand,
  mixamorigRightHandPinky1: VRMHumanBoneName.RightLittleProximal,
  mixamorigRightHandPinky2: VRMHumanBoneName.RightLittleIntermediate,
  mixamorigRightHandPinky3: VRMHumanBoneName.RightLittleDistal,
  mixamorigRightHandRing1: VRMHumanBoneName.RightRingProximal,
  mixamorigRightHandRing2: VRMHumanBoneName.RightRingIntermediate,
  mixamorigRightHandRing3: VRMHumanBoneName.RightRingDistal,
  mixamorigRightHandMiddle1: VRMHumanBoneName.RightMiddleProximal,
  mixamorigRightHandMiddle2: VRMHumanBoneName.RightMiddleIntermediate,
  mixamorigRightHandMiddle3: VRMHumanBoneName.RightMiddleDistal,
  mixamorigRightHandIndex1: VRMHumanBoneName.RightIndexProximal,
  mixamorigRightHandIndex2: VRMHumanBoneName.RightIndexIntermediate,
  mixamorigRightHandIndex3: VRMHumanBoneName.RightIndexDistal,
  mixamorigRightHandThumb1: VRMHumanBoneName.RightThumbMetacarpal,
  mixamorigRightHandThumb2: VRMHumanBoneName.RightThumbProximal,
  mixamorigRightHandThumb3: VRMHumanBoneName.RightThumbDistal,
  mixamorigLeftUpLeg: VRMHumanBoneName.LeftUpperLeg,
  mixamorigLeftLeg: VRMHumanBoneName.LeftLowerLeg,
  mixamorigLeftFoot: VRMHumanBoneName.LeftFoot,
  mixamorigLeftToeBase: VRMHumanBoneName.LeftToes,
  mixamorigRightUpLeg: VRMHumanBoneName.RightUpperLeg,
  mixamorigRightLeg: VRMHumanBoneName.RightLowerLeg,
  mixamorigRightFoot: VRMHumanBoneName.RightFoot,
  mixamorigRightToeBase: VRMHumanBoneName.RightToes
}

export interface MixamoAnimationLoadOptions {
  upperBodyOnly?: boolean
}

const LOWER_BODY_BONES = new Set<HumanBoneName>([
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.LeftToes,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  VRMHumanBoneName.RightToes
])

export async function loadMixamoAnimationClip(
  assetPath: string,
  vrm: VRM,
  clipName: string,
  options: MixamoAnimationLoadOptions = {}
): Promise<THREE.AnimationClip> {
  const loader = new FBXLoader()
  const asset = await loader.loadAsync(assetPath)
  const clip =
    THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') ?? asset.animations[0]

  if (!clip) {
    throw new Error(`FBX asset did not expose any animations: ${assetPath}`)
  }

  const mixamoHips = asset.getObjectByName('mixamorigHips')
  const motionHipsHeight = mixamoHips?.position.y ?? 0
  const vrmHipsHeight =
    vrm.humanoid.normalizedRestPose.hips?.position?.[1] ??
    vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips)?.position.y ??
    1
  const hipsPositionScale =
    Math.abs(motionHipsHeight) > Number.EPSILON ? vrmHipsHeight / motionHipsHeight : 1
  const restRotationInverse = new THREE.Quaternion()
  const parentRestWorldRotation = new THREE.Quaternion()
  const retargetedRotation = new THREE.Quaternion()
  const metaVersion = vrm.meta?.metaVersion
  const tracks: THREE.KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.')

    if (!mixamoRigName || !propertyName) {
      continue
    }

    const vrmBoneName = MIXAMO_VRM_RIG_MAP[mixamoRigName]

    if (!vrmBoneName) {
      continue
    }

    if (options.upperBodyOnly && LOWER_BODY_BONES.has(vrmBoneName)) {
      continue
    }

    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName)
    const mixamoRigNode = asset.getObjectByName(mixamoRigName)

    if (!vrmNode || !mixamoRigNode) {
      continue
    }

    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert()

    if (mixamoRigNode.parent) {
      mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation)
    } else {
      parentRestWorldRotation.identity()
    }

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = Array.from(track.values)

      for (let index = 0; index < values.length; index += 4) {
        retargetedRotation.fromArray(values, index)
        retargetedRotation
          .premultiply(parentRestWorldRotation)
          .multiply(restRotationInverse)
        retargetedRotation.toArray(values, index)

        if (metaVersion === '0') {
          values[index] *= -1
          values[index + 2] *= -1
        }
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${vrmNode.uuid}.${propertyName}`,
          Array.from(track.times),
          values
        )
      )
      continue
    }

    if (track instanceof THREE.VectorKeyframeTrack) {
      const values = Array.from(track.values, (value, index) => {
        const mirroredValue = metaVersion === '0' && index % 3 !== 1 ? -value : value
        return mirroredValue * hipsPositionScale
      })

      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${vrmNode.uuid}.${propertyName}`,
          Array.from(track.times),
          values
        )
      )
    }
  }

  if (tracks.length === 0) {
    throw new Error(`No Mixamo humanoid tracks could be retargeted from ${assetPath}`)
  }

  return new THREE.AnimationClip(clipName, clip.duration, tracks).trim().optimize()
}
