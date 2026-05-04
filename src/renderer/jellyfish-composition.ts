import * as THREE from 'three'
import {
  createBellDetails,
  createBellGeometry,
  createScallopedRimGeometry,
  createUndersideFoldGeometry
} from './jellyfish-geometry'
import {
  createJellyfishMaterials,
  type JellyfishMaterialSet
} from './jellyfish-materials'
import { createJellyfishTentacles } from './jellyfish-tentacles'
import type { JellyfishTentacle } from './jellyfish-types'

export interface JellyfishBuddyComposition {
  bellDetailsRoot: THREE.Group
  bellPivot: THREE.Group
  coreGlow: THREE.Mesh
  glowLight: THREE.PointLight
  innerBell: THREE.Mesh
  oralGlow: THREE.Mesh
  root: THREE.Group
  skirt: THREE.Mesh
  tentacles: JellyfishTentacle[]
}

export function composeJellyfishBuddy(): JellyfishBuddyComposition {
  const materials = createJellyfishMaterials()
  const root = new THREE.Group()
  root.name = 'Jellyfish Buddy'
  root.position.set(0, 0.92, 0)

  const bellPivot = new THREE.Group()
  bellPivot.name = 'Jellyfish bell pivot'
  root.add(bellPivot)

  const bell = new THREE.Mesh(createBellGeometry(), materials.bellMaterial)
  bell.name = 'Jellyfish organic translucent bell'
  bell.position.y = 0.22
  bell.renderOrder = 32
  bellPivot.add(bell)

  const innerBell = new THREE.Mesh(createBellGeometry(), materials.innerBellMaterial)
  innerBell.name = 'Jellyfish faint inner bell'
  innerBell.position.y = 0.075
  innerBell.scale.set(0.74, 0.58, 0.74)
  innerBell.renderOrder = 28
  bellPivot.add(innerBell)

  const bellDetails = createBellDetails(materials.spokeMaterial)
  bellDetails.root.position.y = 0.12
  bellPivot.add(bellDetails.root)

  const skirt = new THREE.Mesh(createScallopedRimGeometry(), materials.skirtMaterial)
  skirt.name = 'Jellyfish scalloped rim skirt'
  skirt.position.y = 0.055
  skirt.renderOrder = 36
  bellPivot.add(skirt)

  const oralGlow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12), materials.oralGlowMaterial)
  oralGlow.name = 'Jellyfish warm oral glow'
  oralGlow.renderOrder = 20
  oralGlow.scale.set(0.46, 0.68, 0.36)
  oralGlow.position.y = -0.01
  bellPivot.add(oralGlow)

  const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), materials.coreGlowMaterial)
  coreGlow.name = 'Jellyfish soft crown glow'
  coreGlow.renderOrder = 40
  coreGlow.scale.set(0.72, 0.42, 0.72)
  coreGlow.position.y = 0.16
  bellPivot.add(coreGlow)

  const glowLight = new THREE.PointLight(0x5ecbff, 1.2, 3.2, 2.2)
  glowLight.name = 'Jellyfish glow light'
  glowLight.position.set(0, 0.02, 0.1)
  root.add(glowLight)

  const { oralCoreGroup, tentacleRoot, undersideFoldGroup } = createUnderBellGroups(root)
  addUndersideFolds(undersideFoldGroup, materials.undersideFoldMaterial)
  const tentacles = createJellyfishTentacles({
    oralCoreGroup,
    tentacleRoot,
    materials: pickTentacleMaterials(materials)
  })

  return {
    bellDetailsRoot: bellDetails.root,
    bellPivot,
    coreGlow,
    glowLight,
    innerBell,
    oralGlow,
    root,
    skirt,
    tentacles
  }
}

function createUnderBellGroups(root: THREE.Group): {
  oralCoreGroup: THREE.Group
  tentacleRoot: THREE.Group
  undersideFoldGroup: THREE.Group
} {
  const underBellRoot = new THREE.Group()
  underBellRoot.name = 'Jellyfish under-bell root'
  root.add(underBellRoot)

  const undersideFoldGroup = new THREE.Group()
  undersideFoldGroup.name = 'Jellyfish soft underside folds'
  underBellRoot.add(undersideFoldGroup)

  const oralCoreGroup = new THREE.Group()
  oralCoreGroup.name = 'Jellyfish oral core ribbons'
  underBellRoot.add(oralCoreGroup)

  const tentacleRoot = new THREE.Group()
  tentacleRoot.name = 'Jellyfish layered tentacle field'
  underBellRoot.add(tentacleRoot)

  return { oralCoreGroup, tentacleRoot, undersideFoldGroup }
}

function addUndersideFolds(group: THREE.Group, material: THREE.MeshBasicMaterial): void {
  for (let index = 0; index < 5; index += 1) {
    const angle = index * 1.21 + Math.sin(index * 1.9) * 0.18
    const fold = new THREE.Mesh(createUndersideFoldGeometry(index), material)
    fold.name = 'Jellyfish soft underside fold'
    fold.position.set(Math.cos(angle) * 0.12, 0.005 + Math.sin(index) * 0.012, Math.sin(angle) * 0.1)
    fold.rotation.y = -angle + Math.PI / 2
    fold.rotation.z = Math.sin(index * 2.4) * 0.18
    fold.renderOrder = 18
    group.add(fold)
  }
}

function pickTentacleMaterials(materials: JellyfishMaterialSet) {
  return {
    filamentMaterial: materials.filamentMaterial,
    oralArmMaterial: materials.oralArmMaterial,
    heroTentacleMaterial: materials.heroTentacleMaterial,
    tentacleRibbonMaterial: materials.tentacleRibbonMaterial
  }
}
