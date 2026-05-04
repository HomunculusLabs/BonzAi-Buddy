import * as THREE from 'three'

export interface JellyfishMaterialSet {
  bellMaterial: THREE.MeshPhysicalMaterial
  coreGlowMaterial: THREE.MeshBasicMaterial
  filamentMaterial: THREE.LineBasicMaterial
  heroTentacleMaterial: THREE.MeshBasicMaterial
  innerBellMaterial: THREE.MeshBasicMaterial
  oralArmMaterial: THREE.MeshBasicMaterial
  oralGlowMaterial: THREE.MeshBasicMaterial
  skirtMaterial: THREE.MeshBasicMaterial
  spokeMaterial: THREE.LineBasicMaterial
  undersideFoldMaterial: THREE.MeshBasicMaterial
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
      opacity: 0.034,
      transparent: true
    }),
    heroTentacleMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xc6ecff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.2,
      side: THREE.DoubleSide,
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
      blending: THREE.NormalBlending,
      color: 0xbadfff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.2,
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
      opacity: 0.06,
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
      color: 0xaee7ff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.115,
      side: THREE.DoubleSide,
      transparent: true
    }),
    undersideFoldMaterial: new THREE.MeshBasicMaterial({
      blending: THREE.NormalBlending,
      color: 0xadddff,
      depthTest: true,
      depthWrite: false,
      opacity: 0.095,
      side: THREE.DoubleSide,
      transparent: true
    })
  }
}
