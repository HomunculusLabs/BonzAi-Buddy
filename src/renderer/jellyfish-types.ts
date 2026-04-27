import * as THREE from 'three'
import type { AssistantEventEmoteId } from '../shared/contracts'

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

export type JellyfishTentacleStyle = 'ribbon' | 'filament' | 'oralArm' | 'hero'

export interface JellyfishTentacle {
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
