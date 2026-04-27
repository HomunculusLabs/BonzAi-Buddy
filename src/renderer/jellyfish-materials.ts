import * as THREE from 'three'

export interface JellyfishMaterialSet {
  bellMaterial: THREE.MeshPhysicalMaterial
  coreGlowMaterial: THREE.MeshBasicMaterial
  filamentMaterial: THREE.LineBasicMaterial
  innerBellMaterial: THREE.MeshBasicMaterial
  oralArmMaterial: THREE.MeshBasicMaterial
  oralGlowMaterial: THREE.MeshBasicMaterial
  skirtMaterial: THREE.MeshBasicMaterial
  spokeMaterial: THREE.LineBasicMaterial
  tentacleRibbonMaterial: THREE.MeshBasicMaterial
}

export function createJellyfishMaterials(): JellyfishMaterialSet {
  return {
    bellMaterial: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: false,
      emissive: 0x2d8dff,
      emissiveIntensity: 0.18,
      metalness: 0,
      opacity: 0.4,
      roughness: 0.34,
      side: THREE.DoubleSide,
      transparent: true,
      vertexColors: true
    }),
    coreGlowMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x4f9dff,
      depthWrite: false,
      opacity: 0.055,
      transparent: true
    }),
    filamentMaterial: new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xd7f4ff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.038,
      transparent: true
    }),
    innerBellMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xc8edff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.085,
      side: THREE.DoubleSide,
      transparent: true,
      vertexColors: true
    }),
    oralArmMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xa9ddff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.165,
      side: THREE.DoubleSide,
      transparent: true
    }),
    oralGlowMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x9edcff,
      depthWrite: false,
      opacity: 0.028,
      transparent: true
    }),
    skirtMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x86ccff,
      depthWrite: false,
      opacity: 0.072,
      transparent: true,
      vertexColors: true
    }),
    spokeMaterial: new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xbceeff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.085,
      transparent: true
    }),
    tentacleRibbonMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x9bddff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.18,
      side: THREE.DoubleSide,
      transparent: true
    })
  }
}
