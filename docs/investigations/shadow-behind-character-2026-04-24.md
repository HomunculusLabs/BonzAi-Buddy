# Investigation: Weird shadow behind character

## Summary
The dark shape behind the character is most likely not a real shadow and not a second canvas/layer. For the bundled `7120171664031727876.vrm`, the strongest remaining explanation is same-mesh material/depth/backface behavior in the standard glTF shader path, with the transparent Electron/WebGL pipeline acting as a possible amplifier of dark edge artifacts.

## Symptoms
- A dark silhouette-like shape appears behind the character in the renderer.
- The artifact is visible behind the legs/arms even though the stage background is transparent.
- The visible artifact looks like a detached duplicate or shadow rather than a CSS box shadow.

## Investigator Findings

### 2026-04-24 — Renderer / model trace and cause analysis

- **Renderer/model flow traced.** The renderer is created once with a single transparent `THREE.WebGLRenderer` on the one stage canvas (`src/renderer/vrm-stage.ts:44-55`; `src/renderer/app.ts:274-276`, `src/renderer/app.ts:434-450`). The load path is `loader.loadAsync(...)` → `finalizeLoadedVrm(...)` → `VRMUtils.rotateVRM0(vrm)` → `normalizeVrmAppearance(vrm)` → `scene.add(vrm.scene)` (`src/renderer/vrm-stage.ts:106-156`, `src/renderer/vrm-stage.ts:171-189`). The animation loop issues a single `renderer.render(scene, camera)` per frame (`src/renderer/vrm-stage.ts:333`).
  - **Evidence:** no secondary renderer, no post-process pass, no second stage canvas.
  - **Conclusion:** app code does not contain an obvious duplicate render path that would paint a second character silhouette.

- **Current outline suppression logic is brittle / incomplete.** `normalizeVrmAppearance` inspects each mesh’s materials, treats any mesh with `isOutline` or `outlineWidthMode !== 'none'` as an “outline mesh,” and then hides the entire mesh via `object.visible = false` (`src/renderer/vrm-stage.ts:499-545`). In the installed `@pixiv/three-vrm` version (`package.json:22-25`), `MToonMaterial` really does expose `isOutline`, `outlineWidthMode`, and `isMToonMaterial` (`node_modules/@pixiv/three-vrm/lib/three-vrm.module.js:3649-3667`), but outline generation in v3.5.2 is implemented by converting **the same mesh** to a material array and appending a cloned outline material, not by creating a separate mesh (`node_modules/@pixiv/three-vrm/lib/three-vrm.module.js:3942-3968`).
  - **Evidence:** `mesh.material = [surfaceMaterial]` followed by `mesh.material.push(outlineMaterial)` and `outlineMaterial.isOutline = true` in the library.
  - **Conclusion:** Bonzi’s suppression logic is not a reliable outline fix for modern `three-vrm`; if it ever matched a real outlined MToon mesh, it would hide the whole skinned mesh, not just the outline pass.

- **For the current bundled VRM, the outline hypothesis does not fit the asset metadata.** A local GLB JSON inspection of `public/static/7120171664031727876.vrm` shows `extensionsUsed: ["VRM"]`, no `VRMC_materials_mtoon` extension, `VRM.materialProperties[*].shader = "VRM_USE_GLTFSHADER"`, and no outline-related float properties. The asset also contains only **one** mesh and **one** skinned mesh node (`Body.001`).
  - **Evidence:** asset JSON dump from the local `.vrm` file (read-only inspection during this investigation).
  - **Conclusion:** the shipped `7120171664031727876.vrm` does not appear to exercise the MToon outline-material path at all, so the current dark silhouette is **not well explained** by outline mesh/material generation in this specific repro, even though Bonzi’s suppression code is brittle for future outlined VRMs.

- **Non-3D duplicate-layer causes were checked and mostly ruled out.** The DOM mounts exactly one `<canvas class="stage-canvas">` (`src/renderer/app.ts:260-276`), and `renderApp` creates one stage controller (`src/renderer/app.ts:434-450`). Window and page backgrounds are intentionally transparent (`src/main/window.ts:5-23`; `src/renderer/styles.css:1-25`, `src/renderer/styles.css:190-209`). There is no CSS box shadow/filter on the stage itself; the notable filter is limited to `.status-pill` (`src/renderer/styles.css:231-245`).
  - **Evidence:** one canvas, one stage controller, transparent stage/window CSS.
  - **Conclusion:** duplicated canvas/layers and ordinary CSS shadow styling are ruled out as the direct source of a character-shaped silhouette.

- **Transparent-window compositing remains plausible, but only as a transparency artifact, not a second render path.** Bonzi clears the WebGL canvas to transparent black (`src/renderer/vrm-stage.ts:87-91`) and does not override Three’s default `premultipliedAlpha = true` (`node_modules/three/src/renderers/WebGLRenderer.js:72-80`). Combined with a transparent Electron window (`src/main/window.ts:10-16`) and `:root { color-scheme: dark; background: transparent; }` (`src/renderer/styles.css:1-12`), this leaves room for dark halo/compositing artifacts around transparent edges. `src/main/index.ts:11-20` also lacks any Linux transparent-visual switch, which could matter on Linux/X11, though that would usually affect the whole window rather than create a model-specific duplicate.
  - **Evidence:** transparent renderer/window setup, default premultiplied alpha, dark color-scheme hint.
  - **Conclusion:** window/compositing behavior is still a plausible contributor, but the code does not show a second app-managed silhouette layer.

- **Animation/proxy/helper objects were ruled out.** The look-at proxy added by `ensureLookAtQuaternionProxy` is a `VRMLookAtQuaternionProxy` `Object3D` child of `vrm.scene` (`src/renderer/vrma-animation-resolver.ts:76-98`), and the pointer target is also a plain `Object3D` (`src/renderer/vrm-stage.ts:57-60`, `src/renderer/vrm-stage.ts:81`). VRMA scenes are disposed after clip extraction (`src/renderer/vrma-animation-resolver.ts:136-160`), and Mixamo FBX assets are loaded only to retarget clips, never attached to the render scene (`src/renderer/mixamo-animation-loader.ts:78-85`; call site `src/renderer/vrma-animation-resolver.ts:169-181`).
  - **Evidence:** these objects have no geometry/material render path in app code.
  - **Conclusion:** animation resolver state, look-at proxy objects, and Mixamo/VRMA helper assets are not the source of the visible silhouette.

- **Most defensible conclusion from the code today:** the prior leading hypothesis should be split in two. **(a)** The current outline-suppression code in `src/renderer/vrm-stage.ts` is indeed brittle/incomplete for `@pixiv/three-vrm` 3.5.2. **(b)** For the currently bundled VRM asset, the dark silhouette is more likely a transparency/compositing or same-mesh depth/backface artifact than an actual outline mesh/material, because the app mounts one canvas, renders once per frame, adds no visible proxy objects, and the asset itself does not advertise MToon outline materials.

<!-- Pair investigator appends structured findings here. -->

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The artifact is coming from the 3D renderer, likely either a duplicate mesh / outline pass / transparency interaction, not a DOM shadow.
**Findings:** Initial code review shows the stage canvas and container are transparent, and mesh shadows are explicitly disabled in `src/renderer/vrm-stage.ts`.
**Evidence:** `src/renderer/styles.css`; `src/renderer/vrm-stage.ts`
**Conclusion:** Prioritize the Three.js / VRM render path.

### Phase 2 - Context Builder + Pair Investigation
**Hypothesis:** The leading candidate is an outline/duplicate render path in the VRM pipeline.
**Findings:** The pair investigator ruled out duplicate canvases, CSS shadow styling, visible helper/proxy objects, and real shadow maps. It also found that Bonzi's current outline suppression is brittle for modern `three-vrm`, but the shipped asset does not appear to use MToon outline metadata at all.
**Evidence:** `src/renderer/app.ts:274-276`, `src/renderer/app.ts:434-450`; `src/renderer/vrm-stage.ts:323-333`, `src/renderer/vrm-stage.ts:490-545`; `src/renderer/vrma-animation-resolver.ts:76-98`; `public/static/7120171664031727876.vrm` metadata inspection.
**Conclusion:** Move the main diagnosis away from 'outline mesh shadow' and toward same-mesh rendering behavior or transparent compositing.

### Phase 3 - Oracle Synthesis
**Hypothesis:** If the asset is not using MToon outlines, the remaining causes are same-mesh material/depth behavior vs transparent-window compositing.
**Findings:** Oracle ranked same-mesh backface/transparency/depth behavior as the primary bucket because the artifact appears localized to model geometry rather than a full-window halo. Transparent-window compositing remains a plausible secondary amplifier because the renderer uses alpha output and the Electron window is also transparent.
**Evidence:** `src/renderer/vrm-stage.ts:48-55`, `src/renderer/vrm-stage.ts:87-91`, `src/renderer/vrm-stage.ts:490-545`; `src/main/window.ts:5-16`.
**Conclusion:** Prioritize renderer/material validation first, with transparent-window toggles as the fastest isolation checks.

## Root Cause
The most plausible root-cause bucket is a **single-mesh rendering artifact** in the VRM's normal glTF material path, not a real shadow map and not a duplicate render layer.

Evidence supporting that conclusion:
- The app creates one `THREE.WebGLRenderer`, mounts one stage canvas, and renders once per frame (`src/renderer/vrm-stage.ts:48-55`, `src/renderer/vrm-stage.ts:84-91`, `src/renderer/vrm-stage.ts:323-333`; `src/renderer/app.ts:274-276`, `src/renderer/app.ts:434-450`).
- CSS and DOM structure do not provide a second character-shaped layer or box-shadow path; the stage, page, and shell backgrounds are transparent (`src/renderer/styles.css:1-25`, `src/renderer/styles.css:190-209`).
- Animation helpers and the look-at proxy do not introduce visible geometry (`src/renderer/vrma-animation-resolver.ts:76-98`, `src/renderer/vrma-animation-resolver.ts:124-160`).
- Mesh shadows are explicitly disabled and shadow maps are never enabled (`src/renderer/vrm-stage.ts:496-497`; no `renderer.shadowMap.enabled` setup exists).
- The bundled asset itself appears to use the legacy `VRM` extension with `VRM_USE_GLTFSHADER`, not `VRMC_materials_mtoon`, and contains only one mesh/skinned-mesh node (`public/static/7120171664031727876.vrm`, read-only GLB metadata inspection during this investigation).

That leaves two realistic explanations:
1. **Primary:** same-mesh backface / double-sided / transparency / depth behavior on the avatar materials, likely visible through gaps around limbs.
2. **Secondary:** transparent-window compositing contamination from the renderer/window alpha pipeline (`alpha: true` + transparent clear color + `transparent: true` Electron window), which can darken edges and make the artifact more noticeable (`src/renderer/vrm-stage.ts:48-55`, `src/renderer/vrm-stage.ts:87-91`, `src/main/window.ts:5-16`).

A related but separate finding: `normalizeVrmAppearance()` is brittle for future outlined MToon assets because it assumes outline metadata on materials and hides the entire mesh when it thinks it found an outline (`src/renderer/vrm-stage.ts:490-545`). However, the current shipped asset does not appear to exercise that outline path, so it is probably not the direct cause of this specific screenshot.

## Recommendations
1. **Validate the transparent compositing path first** in `src/renderer/vrm-stage.ts` and `src/main/window.ts`.
   - Add `premultipliedAlpha: false` at renderer construction (`src/renderer/vrm-stage.ts:48-55`).
   - Temporarily use an opaque clear color instead of `renderer.setClearColor(0x000000, 0)` (`src/renderer/vrm-stage.ts:87-91`).
   - Temporarily disable `transparent: true` / `backgroundColor: '#00000000'` on the Electron window (`src/main/window.ts:5-16`).
   - If the silhouette disappears under opaque rendering, the compositor/alpha pipeline is implicated.
2. **If the artifact persists, harden material normalization** in `normalizeVrmAppearance()` (`src/renderer/vrm-stage.ts:490-545`).
   - Inspect and, where appropriate, force `material.side = THREE.FrontSide`.
   - Ensure `depthTest` / `depthWrite` remain enabled for effectively opaque materials.
   - Clear unnecessary `transparent` state on materials that are visually opaque.
3. **Fix outline suppression separately** for future VRMs.
   - The current logic is unsafe because modern `three-vrm` can append an outline material to the same mesh rather than creating a dedicated outline mesh, so hiding the whole object is not a reliable strategy (`src/renderer/vrm-stage.ts:503-519`).

## Preventive Measures
- Add a small load-time debug dump for mesh/material flags on VRM load so regressions can quickly distinguish outline, transparency, and double-sided material cases.
- Keep an opaque-background debug mode for the stage/window to separate compositor artifacts from model/material artifacts during rendering investigations.
- Treat outline suppression and general material normalization as separate concerns so fixes for future MToon assets do not mask bugs in the standard glTF shader path.
