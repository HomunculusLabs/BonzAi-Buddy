## Final Prompt
<taskname="Jellyfish Polish Plan"/>
<task>Determine how to further improve the current procedural Three.js jellyfish buddy renderer so it looks more biological, less constructed, and more visually polished. Produce an actionable next-iteration visual/technical plan (not code), while preserving existing app architecture and behavior: buddy switching, transparent Electron/Three.js stage, emotes, drag/double-click behavior, custom hit testing, and smooth performance.</task>

<architecture>
- Jellyfish rendering is modularized into composition, geometry, materials, motion envelopes, tentacle generation/deformation, and custom hit testing.
- Runtime integration is centered in `vrm-stage.ts`, which switches VRM/jellyfish subjects, owns frame timing and render updates, and routes emote/drag/double-click/hit-test behavior.
- Scene and visual constraints are managed by `vrm-stage-scene.ts` (transparent renderer, camera framing, lighting rig, tone mapping/exposure, pointer smoothing).
- App-level orchestration (`app.ts` -> `vrm-controller.ts` -> `vrm-stage.ts`) controls buddy selection, interaction wiring, and event forwarding.
- Transparent-window interaction safety depends on renderer shell state + main-process `setIgnoreMouseEvents` coordination (`shell-window-interaction-controller.ts`, `bubble-window-layout.ts`, `window-handlers.ts`, `window.ts`).
</architecture>

<selected_context>
src/renderer/jellyfish-buddy.ts: Jellyfish buddy lifecycle handle; composes scene graph, applies motion pose, updates tentacles per frame, routes emotes/drag/double-click, exposes hit test and metrics.
src/renderer/jellyfish-composition.ts: Hierarchical scene assembly for bell/inner bell/skirt/glows/oral core/tentacle roots; tentacle material routing.
src/renderer/jellyfish-geometry.ts: Procedural bell and rim geometry; tentacle center/index helpers and clustered angular distribution utilities.
src/renderer/jellyfish-materials.ts: Current translucent/additive material presets and depth/opacity-related defaults.
src/renderer/jellyfish-motion.ts: Swim burst, drag-release, emote, and double-click envelope logic producing frame pose outputs.
src/renderer/jellyfish-tentacles.ts: Hero/ribbon/oral-arm/filament population plus per-frame deformation and camera-facing ribbon shaping.
src/renderer/jellyfish-hit-test.ts: Ellipsoid + capsule custom hit region used instead of naive mesh intersection.
src/renderer/jellyfish-types.ts: Shared motion/tentacle interfaces used across modules.

src/renderer/vrm-stage.ts: Subject loading/switching, render tick, jellyfish update hook, event forwarding, and client-point hit-test routing.
src/renderer/vrm-stage-scene.ts: Transparent renderer setup, camera fit constants, lighting, tone mapping, resize handling, pointer target smoothing.
src/renderer/vrm-stage-animation.ts: Existing animation-controller/state-machine patterns from VRM path to mirror for behavioral consistency.
src/renderer/vrm-controller.ts: External renderer facade for load/emote/drag/double-click/hit-test APIs.
src/renderer/app.ts: Buddy persistence, stage double-click hookup, drag integration, assistant event wiring.
src/renderer/app-dom.ts: Shell/stage/bubble DOM structure and buddy selector elements.
src/renderer/styles.css: Shell geometry, pointer-events layering, bubble visibility state classes affecting interactivity.
src/renderer/window-drag-controller.ts: Drag gesture gating and drag-state callbacks.
src/renderer/shell-window-interaction-controller.ts: Hit-test driven click-through switching rules.
src/renderer/bubble-window-layout.ts: Bubble visibility, shell class toggles, expiry/resize behavior tied to interaction state.
src/renderer/conversation-controller.ts: Bubble lifecycle and pending-action state transitions affecting shell interactivity windows.
src/renderer/conversation-view.ts: Conversation bubble rendering/visibility behaviors tied to layout timing.
src/renderer/assistant-event-controller.ts: Assistant event subscription entrypoint.

src/shared/contracts/assistant.ts: Emote/event contracts (`AssistantEventEmoteId`, `AssistantEvent`) constraining behavior surface.
src/shared/ipc-contracts.ts: Shared IPC contract definitions used by preload/renderer.
src/preload/index.ts: Renderer bridge for assistant/window IPC and related interaction plumbing.
src/main/ipc/window-handlers.ts: Main-process mouse ignore policy/failsafe timer.
src/main/window.ts: Transparent BrowserWindow flags, opacity/shadow/compositing-related setup.

package.json: Three.js/Electron/VRM dependency version context.
docs/investigations/shadow-behind-character-2026-04-24.md: Prior findings on translucent compositing artifacts and material tradeoffs.
docs/investigations/electron-window-shadow-compositing-2026-04-24.md: Transparent-window compositing constraints and mitigations.
docs/investigations/bonzi-desktop-hitbox-drag-regression-2026-04-27.md: Hitbox/drag/click-through regression constraints to preserve.
</selected_context>

<relationships>
- Buddy switch flow: `app.ts` buddy selection -> `vrmController.load(...)` -> `vrm-stage.load(...)` -> jellyfish creation via `createJellyfishBuddy(...)`.
- Frame flow: `vrm-stage` tick -> `stageScene.updatePointerTarget(...)` -> `currentJellyfish.update(...)` -> `updateJellyfishTentacles(...)` -> renderer draw.
- Emote flow: assistant event -> `app.ts` -> `vrmController.playOrQueueEmote(...)` -> `vrm-stage.playBuiltInEmote(...)` -> jellyfish motion state.
- Drag flow: `window-drag-controller` -> `vrmController.setDragging(...)` -> `vrm-stage.setDragging(...)` -> jellyfish drag envelope.
- Double-click flow: stage dblclick handler in `app.ts` -> controller -> stage -> jellyfish burst envelope.
- Hit-test flow: shell interaction controller -> `vrmController.hitTestClientPoint(...)` -> `vrm-stage.hitTestClientPoint(...)` -> jellyfish custom ellipsoid/capsule hit test.
- Interactivity boundary: bubble visibility/class state + shell click-through policy + main-process mouse-ignore timer jointly define safe behavior envelope for visual changes.
</relationships>

<ambiguities>
- Emote contract is intentionally narrow (`wave`, `happy-bounce`); clarify in the plan whether richer jellyfish behavior stays internal to existing IDs or proposes contract expansion.
</ambiguities>

## Selection
- Files: 37 total (30 full, 7 codemap)
- Total tokens: 61249 (Auto view)
- Token breakdown: full 59788, codemap 1461

### Files
### Selected Files
/Users/t3rpz/projects/bonzi/
├── docs/
│   └── investigations/
│       ├── bonzi-desktop-hitbox-drag-regression-2026-04-27.md — 4,907 tokens (full)
│       ├── electron-window-shadow-compositing-2026-04-24.md — 3,294 tokens (full)
│       └── shadow-behind-character-2026-04-24.md — 3,443 tokens (full)
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── window-handlers.ts — 832 tokens (full)
│   │   └── window.ts — 550 tokens (full)
│   ├── preload/
│   │   └── index.ts — 1,221 tokens (full)
│   ├── renderer/
│   │   ├── app-dom.ts — 4,257 tokens (full)
│   │   ├── app.ts — 3,591 tokens (full)
│   │   ├── assistant-event-controller.ts — 123 tokens (full)
│   │   ├── bubble-window-layout.ts — 1,757 tokens (full)
│   │   ├── conversation-controller.ts — 2,433 tokens (full)
│   │   ├── conversation-view.ts — 3,698 tokens (full)
│   │   ├── jellyfish-buddy.ts — 1,264 tokens (full)
│   │   ├── jellyfish-composition.ts — 953 tokens (full)
│   │   ├── jellyfish-geometry.ts — 1,679 tokens (full)
│   │   ├── jellyfish-hit-test.ts — 362 tokens (full)
│   │   ├── jellyfish-materials.ts — 706 tokens (full)
│   │   ├── jellyfish-motion.ts — 1,772 tokens (full)
│   │   ├── jellyfish-tentacles.ts — 2,967 tokens (full)
│   │   ├── jellyfish-types.ts — 332 tokens (full)
│   │   ├── shell-window-interaction-controller.ts — 1,085 tokens (full)
│   │   ├── styles.css — 8,832 tokens (full)
│   │   ├── vrm-controller.ts — 1,061 tokens (full)
│   │   ├── vrm-stage-animation.ts — 2,069 tokens (full)
│   │   ├── vrm-stage-scene.ts — 1,573 tokens (full)
│   │   ├── vrm-stage.ts — 2,747 tokens (full)
│   │   └── window-drag-controller.ts — 796 tokens (full)
│   └── shared/
│       ├── contracts/
│       │   └── assistant.ts — 773 tokens (full)
│       └── ipc-contracts.ts — 434 tokens (full)
└── package.json — 277 tokens (full)

### Codemaps
/Users/t3rpz/projects/bonzi/
└── src/
    ├── renderer/
    │   └── vrma-animation-resolver.ts — 444 tokens (auto)
    └── shared/
        ├── contracts/
        │   └── workflow.ts — 656 tokens (auto)
        └── ipc/
            ├── app-ipc.ts — 51 tokens (auto)
            ├── assistant-ipc.ts — 84 tokens (auto)
            ├── plugins-ipc.ts — 56 tokens (auto)
            ├── settings-ipc.ts — 57 tokens (auto)
            └── window-ipc.ts — 113 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `jellyfish-polish-plan-5BE20C` | **Mode**: plan

### Response
## 1. Summary

Improve the procedural jellyfish through a targeted renderer iteration, not a broad architecture refactor. Keep the existing buddy switching, stage lifecycle, emote/drag/double-click routing, transparent Electron window behavior, and custom hit testing unchanged. The next iteration should focus on: richer biological anatomy, less uniform procedural geometry, subtler translucent materials, dynamic bell/rim deformation, more organic tentacle anchoring and motion, and carefully bounded draw-call/alpha-compositing changes.

## 2. Current-state analysis

The current jellyfish path is cleanly modularized:

- `app.ts` persists/selects `BuddyKind`, then calls `vrmController.load(...)`.
- `vrm-controller.ts` forwards load/emote/drag/double-click/hit-test calls to `vrm-stage.ts`.
- `vrm-stage.ts` owns the render loop and switches between VRM and jellyfish subjects.
- `createJellyfishBuddy(scene)` in `jellyfish-buddy.ts` composes the jellyfish, adds its root to the shared Three scene, owns `JellyfishMotionState`, and updates visual transforms each frame.
- `jellyfish-motion.ts` produces a `JellyfishFramePose` from elapsed time, pointer NDC, drag state, emote state, and double-click burst state.
- `jellyfish-tentacles.ts` owns tentacle population and per-frame deformation with scratch vectors to avoid allocations.
- `jellyfish-hit-test.ts` uses a custom ellipsoid + capsule rather than mesh raycasting, which is important for stable drag/click-through behavior.
- `vrm-stage-scene.ts` owns transparent WebGL setup, camera framing, lighting, pointer smoothing, resize behavior, and render.

Reusable strengths:

- Scene graph ownership and disposal already work through `root.traverse(...)`.
- Motion envelopes already centralize behavior triggers.
- Tentacle deformation is already isolated and allocation-conscious.
- Custom hit testing already prevents transparent/additive geometry from creating unreliable interaction regions.
- Existing `loadId`/`disposed` checks in `vrm-stage.ts` protect async subject switching.

Blocking visual limitations:

- Bell/skirt geometry is mostly static; motion is mainly group scaling and rotation.
- Radial veins, tentacles, and rim details are visibly regular and symmetrical.
- Materials lean heavily on additive translucency, which can look constructed/neon rather than biological.
- Tentacle anchors are derived from angle/radius formulas only; they lack attachment irregularity and anatomical grouping.
- Current pose output does not expose enough biological signals for dynamic membrane deformation, internal glow response, or rim flutter.

## 3. Design

### A. Scope decision

Use a targeted visual-system expansion inside the existing jellyfish modules.

Do **not** change:

- `BuddyKind`
- IPC contracts
- `AssistantEventEmoteId`
- app-level buddy selection flow
- Electron transparency/window policy
- shell click-through policy
- VRM path behavior

The emote contract should remain `wave | happy-bounce`. Richer jellyfish-specific behavior should be mapped internally to those existing IDs.

---

### B. Organic anatomy additions

#### Modify `src/renderer/jellyfish-composition.ts`

Extend `JellyfishBuddyComposition` with additional biological subgroups:

```ts
interface JellyfishBuddyComposition {
  // existing fields...
  anatomyRoot: THREE.Group
  canalRoot: THREE.Group
  marginalBulbs: THREE.InstancedMesh
  planktonField: THREE.Points
  dynamicMaterials: JellyfishDynamicMaterialRefs
  disposableTextures: THREE.Texture[]
  deformables: JellyfishSurfaceDeformableSet
}
```

Add these visual elements:

1. **Canal system**
   - Replace or supplement the current simple `bellDetailsRoot` radial veins.
   - Use one or two combined `THREE.LineSegments` geometries instead of many independent line objects.
   - Include:
     - faint radial canals from crown toward rim
     - an uneven ring canal near the rim
     - a few shorter branching canal segments
   - Keep opacity low; this should look embedded under the bell, not drawn on top.

2. **Marginal bulbs**
   - Add a single `THREE.InstancedMesh` of small translucent spheres around the rim.
   - Use deterministic per-instance size/position variation.
   - Target count: 24–36 instances.
   - Purpose: break the perfectly constructed rim silhouette and add biological detail without many draw calls.

3. **Internal suspended particles**
   - Add a small `THREE.Points` field under/inside the bell.
   - Target count: 24–48 points.
   - Very low opacity, slow pulse through material opacity only.
   - Must not participate in hit testing.

4. **Under-bell veil**
   - Add one soft translucent membrane/ring under the bell, separate from the scalloped rim.
   - This should visually connect the bell to oral arms and reduce the “parts assembled together” look.

Rationale: these additions improve biological readability while staying inside the existing composition/render-loop architecture.

---

### C. Dynamic bell and rim deformation

Add a small helper module:

#### New file: `src/renderer/jellyfish-surface-deformation.ts`

Kind: renderer-local module.

Purpose: isolate per-frame vertex mutation so `jellyfish-buddy.ts` does not become geometry-heavy.

Owns no global state. It should operate on handles created at composition time.

Suggested interface shape:

```ts
type JellyfishSurfaceKind = 'bell' | 'innerBell' | 'skirt' | 'veil'

interface JellyfishSurfaceDeformer {
  kind: JellyfishSurfaceKind
  geometry: THREE.BufferGeometry
  basePositions: Float32Array
}

interface JellyfishSurfaceDeformableSet {
  bell: JellyfishSurfaceDeformer
  innerBell: JellyfishSurfaceDeformer
  skirt: JellyfishSurfaceDeformer
  veil?: JellyfishSurfaceDeformer
}

function createSurfaceDeformer(
  kind: JellyfishSurfaceKind,
  geometry: THREE.BufferGeometry
): JellyfishSurfaceDeformer

function updateJellyfishSurfaces(
  surfaces: JellyfishSurfaceDeformableSet,
  pose: JellyfishFramePose,
  elapsed: number
): void
```

Behavior:

- Clone the initial `position` attribute into `basePositions`.
- On each frame, mutate only the existing `position` buffer.
- Mark `position.needsUpdate = true`.
- Keep conservative bounding spheres instead of recomputing bounds every frame.
- Recompute normals for bell/inner bell only if needed; geometry size is small enough, but avoid normals for line/points systems.

#### Modify `src/renderer/jellyfish-geometry.ts`

Add lightweight custom metadata attributes to bell/skirt geometry where useful:

- Bell metadata per vertex: normalized radial coordinate, vertical coordinate, rim influence.
- Skirt metadata per vertex: angular coordinate, inner/outer edge flag.

These attributes are internal to deformation; they do not change material contracts.

Dynamic deformation should add:

- uneven bell breathing during swim pulse
- lopsided rim flutter
- slight crown lag after contractions
- subtle asymmetric surface wobble during drag and double-click burst

The visual invariant: the jellyfish should still occupy approximately the current stage footprint.

---

### D. Motion pose expansion

#### Modify `src/renderer/jellyfish-types.ts`

Extend `JellyfishFramePose` with biological animation signals:

```ts
interface JellyfishFramePose {
  // existing fields...

  bellContraction: number
  bellSurfaceRipple: number
  bellSurfaceRipplePhase: number
  rimFlutter: number
  oralArmCurl: number
  canalGlowIntensity: number
  particleGlowIntensity: number
}
```

#### Modify `src/renderer/jellyfish-motion.ts`

Keep the current state machine but enrich pose calculations.

Add:

- a slower biological breathing cycle independent of swim bursts
- contraction lag after swim burst / happy bounce / double click
- lower-frequency drift in root position
- stronger `rimFlutter` during drag release and double-click
- `oralArmCurl` response during `wave`
- `canalGlowIntensity` response during happy bounce and swim bursts

Do not add new public emote IDs.

Mapping:

- `happy-bounce`: stronger bell contraction, brighter canals, upward buoyancy.
- `wave`: asymmetric root tilt, oral-arm curl, side-biased tentacle sway.
- drag hold: compressed bell + higher tentacle energy.
- drag release: delayed rim wobble.
- double click: short bright pulse + fast bell contraction + tentacle flare.

---

### E. Material polish and compositing safety

#### Modify `src/renderer/jellyfish-materials.ts`

Add new material refs to `JellyfishMaterialSet`:

```ts
interface JellyfishMaterialSet {
  // existing...
  canalMaterial: THREE.LineBasicMaterial
  marginalBulbMaterial: THREE.MeshBasicMaterial
  planktonMaterial: THREE.PointsMaterial
  veilMaterial: THREE.MeshBasicMaterial
}
```

Also add a dynamic refs shape exposed through composition:

```ts
interface JellyfishDynamicMaterialRefs {
  canalMaterial: THREE.LineBasicMaterial
  coreGlowMaterial: THREE.MeshBasicMaterial
  marginalBulbMaterial: THREE.MeshBasicMaterial
  oralGlowMaterial: THREE.MeshBasicMaterial
  planktonMaterial: THREE.PointsMaterial
}
```

Material direction:

- Keep main bell translucent but reduce “neon shell” feel.
- Use additive blending only for glow accents, canals, and particles.
- Use normal transparent blending for the main bell/veil where possible.
- Avoid adding dark shadows, CSS filters, or compositor-affecting DOM effects.
- Preserve `depthTest: true` on translucent structural elements.
- Keep `depthWrite: false` for transparent jellyfish pieces to avoid self-occlusion artifacts.

If procedural textures are added:

- Use small `CanvasTexture`s only.
- Return them as `disposableTextures` from composition.
- Dispose them explicitly in `jellyfish-buddy.ts`, because material disposal alone should not be relied on for texture cleanup.

Transparent-window constraint:

- Validate in both normal transparent mode and `BONZI_OPAQUE_WINDOW=1`.
- If halos appear, first reduce additive opacity and overlapping coplanar surfaces rather than changing Electron/window renderer configuration.

---

### F. Tentacle system: more biological attachment and motion

#### Modify `src/renderer/jellyfish-types.ts`

Extend `JellyfishTentacle`:

```ts
interface JellyfishTentacle {
  // existing...
  anchor: THREE.Vector3
  curlBias: number
  currentBias: number
  depthBias: number
  energyResponse: number
  thicknessNoise: number
}
```

#### Modify `src/renderer/jellyfish-tentacles.ts`

Change tentacle creation from mostly angle/radius formulas to deterministic anatomical anchors.

Population changes:

1. **Hero tentacles**
   - Keep count near current level.
   - Make 3–4 visibly longer primary tendrils.
   - Anchor them under distinct rim lobes, not evenly around a circle.

2. **Ribbon tentacles**
   - Use irregular clusters with varied Y attachment points.
   - Increase length variance slightly.
   - Add curl bias so tips do not all terminate in similar curves.

3. **Oral arms**
   - Make them broader near the bell and frillier through motion, not by excessive new geometry.
   - Use `oralArmCurl` from pose to create more living, folding movement.

4. **Filaments**
   - Keep fine and numerous but introduce depth layering and length variation.
   - Avoid perfect circular distribution.

Update algorithm:

- Use `anchor` as the starting point instead of recomputing only from `angle/baseRadius/startY`.
- Apply bell pulse coupling differently by style:
  - oral arms: high coupling
  - hero tentacles: delayed, strong tip response
  - filaments: delayed, lower amplitude
- Preserve existing scratch vectors and avoid per-frame allocation.

Performance target:

- Do not increase total tentacle object count by more than ~25%.
- Prefer more variation in existing tentacles over many new meshes.

---

### G. Hit testing and metrics

#### Modify `src/renderer/jellyfish-hit-test.ts`

Keep the custom ellipsoid + capsule strategy.

Adjust only if the new visible footprint changes:

- Bell ellipsoid should cover marginal bulbs and wider rim.
- Capsule should cover the central oral-arm/tentacle body enough for drag but not the full long filaments.
- Do not switch to mesh raycasting; translucent/line/points geometry would make drag and click-through behavior unstable.

Suggested target:

- Slightly widen bell hit ellipsoid.
- Slightly extend capsule downward.
- Keep hit region forgiving around the biological body, not every filament.

#### Modify `src/renderer/jellyfish-buddy.ts`

Update `metrics` only if the final silhouette grows:

- Keep `rootHeight` close to current value.
- Do not significantly increase stage footprint, because bubble layout and drag interaction depend on predictable window geometry.
- If needed, target approximately:
  - `rootHeight`: `1.82–1.9`
  - `size.x`: `1.3–1.4`
  - `size.y`: `1.85–1.95`
  - `size.z`: `1.05–1.15`

---

### H. Lifecycle, concurrency, and failure behavior

No new async behavior should be introduced.

Lifecycle rules:

- All new meshes/groups are children of the jellyfish `root`.
- Existing `root.traverse(...)` disposal should handle geometries/materials.
- Explicitly dispose procedural textures if added.
- Do not retain references outside `JellyfishBuddyHandle`.
- `createJellyfishBuddy(...)` remains synchronous and can still throw; `vrm-stage.ts` already catches jellyfish load failures.

Frame update rules:

- No allocations in the hot update path except unavoidable Three internals.
- Reuse scratch vectors/arrays.
- Mutate existing buffer attributes.
- Avoid `Math.random()` in construction; use deterministic hash/sine-based variation so the jellyfish is stable across loads.

Out-of-order/dropped events:

- Existing motion state behavior is sufficient.
- Duplicate drag state calls should remain no-ops through `setJellyfishDragging(...)`.
- Duplicate emotes simply restart/override active emote as today.
- Dropped frames should remain safe because `delta` is capped in `vrm-stage.ts`.

## 4. File-by-file impact

### `src/renderer/jellyfish-types.ts`

Changes:

- Add new `JellyfishFramePose` fields for biological deformation/material signals.
- Add new `JellyfishTentacle` fields for anchor and motion variation.
- Optionally export `JellyfishSurfaceDeformableSet` if shared across modules.

Why:

- Motion needs to drive geometry/material polish without coupling modules.

Dependencies:

- Must land with `jellyfish-motion.ts`, `jellyfish-tentacles.ts`, and `jellyfish-buddy.ts`.

---

### `src/renderer/jellyfish-motion.ts`

Changes:

- Extend pose generation with contraction, rim flutter, canal glow, particle glow, and oral-arm curl.
- Preserve existing public functions and behavior triggers.
- Keep emote contract unchanged.

Why:

- Provides biological control signals for new visual systems.

Dependencies:

- Depends on updated `JellyfishFramePose`.

---

### `src/renderer/jellyfish-geometry.ts`

Changes:

- Add metadata attributes to bell/skirt geometry.
- Add helpers for:
  - irregular ring canal point generation
  - marginal bulb transform generation
  - optional deterministic organic noise/hash
  - veil/ring membrane geometry if not placed in composition

Why:

- Makes geometry less regular and supports dynamic deformation.

Dependencies:

- Used by `jellyfish-composition.ts` and new surface deformation module.

---

### `src/renderer/jellyfish-materials.ts`

Changes:

- Add materials for canal lines, marginal bulbs, plankton points, and veil.
- Tune existing opacity/blending balance to reduce constructed neon look.
- If textures are introduced, expose texture references for explicit disposal.

Why:

- Biological polish depends heavily on subtle layered translucency.

Dependencies:

- Used by `jellyfish-composition.ts` and dynamic material updates in `jellyfish-buddy.ts`.

---

### `src/renderer/jellyfish-composition.ts`

Changes:

- Add anatomy groups and meshes:
  - `anatomyRoot`
  - `canalRoot`
  - `marginalBulbs`
  - `planktonField`
  - optional veil mesh
- Return `dynamicMaterials`, `disposableTextures`, and `deformables`.
- Keep root hierarchy under a single `root`.

Why:

- Centralizes scene assembly and avoids scattering mesh creation into update logic.

Dependencies:

- Depends on new geometry/material helpers and surface deformer creation.

---

### `src/renderer/jellyfish-surface-deformation.ts`

Changes:

- New helper module for creating and updating deformable surface handles.

Why:

- Keeps per-frame vertex mutation out of composition and buddy lifecycle code.

Dependencies:

- Used by `jellyfish-composition.ts` and `jellyfish-buddy.ts`.

---

### `src/renderer/jellyfish-tentacles.ts`

Changes:

- Populate new tentacle fields.
- Use anchors in `computeTentacleCenter(...)`.
- Add style-specific lag/curl/current behavior.
- Feed `oralArmCurl` through update path, either by adding an argument or bundling pose-derived tentacle parameters.

Why:

- Makes tentacles look attached, weighted, and current-driven rather than evenly distributed procedural strips.

Dependencies:

- Depends on updated `JellyfishTentacle` and `JellyfishFramePose`.

---

### `src/renderer/jellyfish-buddy.ts`

Changes:

- Destructure new composition fields.
- Call `updateJellyfishSurfaces(...)` each frame.
- Update dynamic material opacities/intensities from pose.
- Pass new pose-driven parameters to tentacle updates.
- Dispose procedural textures explicitly if added.
- Adjust metrics only if needed.

Why:

- This remains the correct lifecycle/update coordinator for the jellyfish subject.

Dependencies:

- Depends on all jellyfish module changes.

---

### `src/renderer/jellyfish-hit-test.ts`

Changes:

- Slightly tune ellipsoid/capsule constants if the silhouette changes.
- Keep custom analytic hit testing.

Why:

- Preserves drag/click-through safety while matching the improved body footprint.

Dependencies:

- Should be tuned after final visual size is known.

---

### Files intentionally unchanged

- `src/renderer/vrm-stage.ts`
- `src/renderer/vrm-stage-scene.ts`
- `src/renderer/vrm-controller.ts`
- `src/renderer/app.ts`
- `src/renderer/window-drag-controller.ts`
- `src/renderer/shell-window-interaction-controller.ts`
- `src/main/window.ts`
- `src/main/ipc/window-handlers.ts`
- shared IPC/contracts

Reason:

- The requested polish can be achieved inside the jellyfish renderer without changing app behavior, public contracts, or Electron interaction policy.

## 5. Risks and migration

No persistence, IPC, or public API migration is required.

Main risks:

1. **Transparent compositing artifacts**
   - New translucent layers can create halos.
   - Mitigation: keep opacities low, avoid coplanar overlapping additive surfaces, validate with transparent and opaque debug modes.

2. **Performance regression**
   - New anatomy can increase draw calls.
   - Mitigation: use `InstancedMesh` for bulbs, combined geometry for canal lines, and bounded point counts.

3. **Hit-test mismatch**
   - A wider visual silhouette may not match drag region.
   - Mitigation: tune analytic ellipsoid/capsule after visual pass; do not raycast translucent meshes.

4. **Over-polishing into visual noise**
   - Too many bright details could make the buddy less readable.
   - Mitigation: prioritize silhouette, slow motion, and subtle internal anatomy over high-frequency glow.

## 6. Implementation order

1. **Extend types and pose signals**
   - Update `jellyfish-types.ts`.
   - Update `jellyfish-motion.ts`.
   - Typecheck pose consumers.

2. **Add surface deformation infrastructure**
   - Add `jellyfish-surface-deformation.ts`.
   - Add metadata/base-position support in `jellyfish-geometry.ts`.
   - Wire deformation into `jellyfish-buddy.ts` with minimal visual amplitude first.

3. **Add anatomy materials and composition**
   - Extend `jellyfish-materials.ts`.
   - Add canal system, marginal bulbs, plankton points, and veil in `jellyfish-composition.ts`.
   - Ensure disposal covers all new resources.

4. **Upgrade tentacle anchoring and deformation**
   - Extend creation data in `jellyfish-tentacles.ts`.
   - Replace purely radial starts with anchors.
   - Add style-specific curl/current response.

5. **Tune visual balance**
   - Adjust opacity, render order, glow intensity, deformation amplitude, and tentacle energy.
   - Validate transparent-window appearance.

6. **Tune hit test and metrics**
   - Adjust `jellyfish-hit-test.ts` constants only after final silhouette is stable.
   - Adjust `metrics` in `jellyfish-buddy.ts` only if framing visibly clips or over-zooms.

7. **Regression validation**
   - Buddy switch Bonzi ↔ Jellyfish.
   - Assistant `wave` and `happy-bounce`.
   - Drag hold/release.
   - Double-click burst and UI toggle.
   - Bubble expiry followed by drag.
   - Transparent mode and `BONZI_OPAQUE_WINDOW=1`.
   - Run TypeScript typecheck.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "jellyfish-polish-plan-5BE20C", new_chat: false)