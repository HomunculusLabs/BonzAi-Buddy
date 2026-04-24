# Investigation: Electron window shadow / compositing artifact

## Summary
The strongest explanation is that Bonzi is hitting an Electron/Chromium transparent-window compositing or shadow-invalidation artifact at the shared `BrowserWindow` surface, not a VRM-only rendering bug. Bonzi’s transparent WebGL renderer likely amplifies the avatar edges, but the artifact appearing behind both the DOM speech bubble and the WebGL model points to the transparent frameless window path as the primary root-cause bucket.

## Symptoms
- A dark silhouette-like artifact appears behind the VRM character.
- The artifact also appears behind the speech bubble, not just the 3D model.
- The Electron window is transparent and frameless.
- Prior rendering-focused investigation did not find a duplicate canvas or a separate VRM outline-material path for the bundled asset.

## Background / Prior Research
- **Electron BrowserWindow docs explicitly warn about transparent-window artifacts on macOS.** The official `BrowserWindow` API docs say `invalidateShadow()` exists because transparent `BrowserWindows` can sometimes leave behind visual artifacts on macOS, and the same page documents `setHasShadow(hasShadow)` / `hasShadow()` as the native shadow controls. Source: Electron `BrowserWindow` docs (`https://www.electronjs.org/docs/latest/api/browser-window`, lines around `win.invalidateShadow()` / `win.setHasShadow()`).
- **Electron’s transparent-window tutorial says transparent windows do not show a native shadow on macOS.** The official custom-window-styles tutorial states that on macOS, “The native window shadow will not be shown on a transparent window.” This is relevant because Bonzi is intentionally using a frameless transparent overlay window. Source: Electron custom window styles tutorial (`https://www.electronjs.org/docs/latest/tutorial/custom-window-styles`, transparent-window limitations section).
- **Electron docs tie guest-page colors to the root color scheme when transparency is enabled.** The `BrowserWindow` constructor docs note that with transparency enabled for the guest page, text/background colors are derived from the root element’s color scheme while the background remains transparent. This matters because Bonzi sets `:root { color-scheme: dark; background: transparent; }` in the renderer CSS. Source: Electron `BrowserWindow` docs (`transparent` web preference description).
- **Electron issue tracker contains ongoing transparency/compositing bugs on real overlay apps.** An open Electron issue reports that transparent frameless always-on-top overlay windows can render with black/gray backgrounds on some systems when hardware acceleration is enabled, and notes that disabling hardware acceleration helps some users. Source: electron/electron issue `#40515` (`[Bug]: window transparency not respected (black/gray background) on some systems`, opened 2023-11-13).
- **Older Electron issues also show transparent-window regressions/artifacts across platforms.** For example, macOS transparent windows showing white backgrounds after navigation (`#20357`) and longstanding Windows black-background regressions (`#1270`) indicate transparent-window compositing has a history of platform-specific artifact behavior. These do not prove Bonzi’s exact bug, but they strengthen the case that the shared artifact behind both DOM and WebGL content can originate in the Electron/Chromium transparent-window stack.


## Investigator Findings

### 2026-04-24 — Electron transparent-window path is the shared failure domain

- **The main window uses the exact high-risk transparent overlay configuration.** `createCompanionWindow()` constructs a frameless transparent always-on-top `BrowserWindow` with a fully transparent background (`src/main/window.ts:4-23`). Specifically, it sets `transparent: true`, `frame: false`, `alwaysOnTop: true`, and `backgroundColor: '#00000000'` (`src/main/window.ts:10-17`), then also calls `companionWindow.setAlwaysOnTop(true, 'floating')` (`src/main/window.ts:26`).
  - **Evidence:** `src/main/window.ts:10-17`, `src/main/window.ts:26`.
  - **Conclusion:** the app is definitely on Electron’s transparent-window compositor path.

- **Bonzi never explicitly disables or invalidates native shadow/compositor state.** The main process does not set `hasShadow: false` in the constructor, does not call `setHasShadow(false)`, and does not call `invalidateShadow()` after load/show (`src/main/window.ts:4-45`).
  - **Evidence:** complete `src/main/window.ts` shows none of these APIs are used.
  - **Conclusion:** Electron’s documented shadow/compositor mitigation hooks are absent from the current implementation.

- **No GPU/compositor debug toggles exist in app startup.** `src/main/index.ts` only registers IPC and opens the window; there are no `app.disableHardwareAcceleration()` calls and no Chromium command-line compositor switches (`src/main/index.ts:1-20`).
  - **Evidence:** `src/main/index.ts:1-20`.
  - **Conclusion:** there is currently no easy way in-app to isolate GPU compositor involvement.

- **The bubble and WebGL stage share the same transparent renderer surface.** In `renderApp()`, the speech bubble and the stage canvas are siblings under the same `.stage-card` subtree (`src/renderer/app.ts:243-282`). CSS keeps that whole chain transparent: `:root`, `html`, `body`, `#app`, `.shell`, `.stage-card`, `.stage-shell`, and `.stage-canvas` all use transparent backgrounds (`src/renderer/styles.css:1-25`, `src/renderer/styles.css:40-49`, `src/renderer/styles.css:165-209`).
  - **Evidence:** `src/renderer/app.ts:260-276`; `src/renderer/styles.css:1-25`; `src/renderer/styles.css:40-49`; `src/renderer/styles.css:165-209`.
  - **Conclusion:** the shared artifact behind both the bubble and avatar is best explained by the common transparent window/compositing surface, not by a model-only path.

- **There is no shared CSS shadow/filter wrapper around both elements.** The stage shell and speech-bubble container themselves are transparent (`src/renderer/styles.css:165-209`), and the one `backdrop-filter` in the file is scoped to `.status-pill` only (`src/renderer/styles.css:231-245`).
  - **Evidence:** `src/renderer/styles.css:165-209`, `src/renderer/styles.css:231-245`.
  - **Conclusion:** ordinary CSS shadow/filter styling does not explain the shared ghost.

- **The renderer can amplify the visual severity but does not adequately explain the speech-bubble artifact by itself.** The WebGL renderer is alpha-enabled and clears to fully transparent black, then applies ACES tone mapping and exposure (`src/renderer/vrm-stage.ts:44-55`, `src/renderer/vrm-stage.ts:87-91`). That can darken/halo avatar edges, but it cannot by itself explain the same shadow-like artifact behind the DOM bubble because the bubble is not drawn through the WebGL pipeline.
  - **Evidence:** `src/renderer/vrm-stage.ts:48-55`, `src/renderer/vrm-stage.ts:87-91`.
  - **Conclusion:** renderer config is a secondary amplifier, not the best primary cause.

- **External Electron docs support this diagnosis.** Electron’s official `BrowserWindow` docs say transparent windows can sometimes leave behind visual artifacts on macOS and document `invalidateShadow()` for that case; the same API page documents `setHasShadow()`. Electron’s transparent-window tutorial also notes that on macOS the normal native shadow is not shown on transparent windows, which fits the idea that this is a compositor/shadow-path artifact rather than an intentional normal shadow. See `## Background / Prior Research` above.
  - **Conclusion:** Electron’s own docs describe a class of artifact behavior that matches the shared ghost symptom better than a renderer-only theory.

- **Most decisive fixes/tests live in the main process, not the renderer.** The strongest next tests are: (1) add an opaque-window debug mode in `src/main/window.ts`; (2) set `hasShadow: false` and call `setHasShadow(false)`; (3) call `invalidateShadow()` after the window is ready/showing; (4) add a GPU-disable debug toggle in `src/main/index.ts`. If the bubble ghost disappears when the window is opaque or GPU compositing is disabled, the transparent `BrowserWindow` compositor path is confirmed.
  - **Conclusion:** main-process Electron window configuration should be treated as the primary fix surface.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Because the artifact appears behind both the VRM body and the DOM speech bubble, the common layer is likely Electron/Chromium window compositing rather than only the VRM mesh pipeline.
**Findings:** Existing repo investigation already ruled out duplicate canvases, CSS box-shadow styling, visible helper objects, and likely MToon outline generation for the current asset.
**Evidence:** `/Users/t3rpz/projects/bonzi/docs/investigations/shadow-behind-character-2026-04-24.md`
**Conclusion:** Investigate transparent Electron window behavior, native shadow/compositing behavior, and app/window configuration.

## Root Cause
The most defensible root cause is an **Electron/Chromium transparent-window compositing or shadow-invalidation artifact at the shared `BrowserWindow` surface**.

Evidence for that conclusion:
- Bonzi uses a frameless transparent always-on-top `BrowserWindow` with `backgroundColor: '#00000000'` (`src/main/window.ts:10-17`), which is the exact class of overlay configuration Electron has historically had artifact issues with.
- The dark ghost appears behind **both** the WebGL avatar and the DOM speech bubble. Those two elements are siblings under the same transparent renderer tree (`src/renderer/app.ts:260-276`), so their common failure domain is the transparent window/compositor surface rather than only the VRM render path.
- CSS does not provide a shared shadow/filter wrapper around both the bubble and the canvas (`src/renderer/styles.css:165-209`, `src/renderer/styles.css:231-245`).
- The renderer does use an alpha WebGL pipeline with transparent clear color and tone mapping (`src/renderer/vrm-stage.ts:48-55`, `src/renderer/vrm-stage.ts:87-91`), which can amplify avatar edges, but that still does not explain the same ghost behind the DOM bubble.
- Electron’s official docs explicitly say transparent BrowserWindows can leave visual artifacts on macOS and expose `invalidateShadow()` / `setHasShadow()` as the relevant APIs; Bonzi currently uses neither (`src/main/window.ts:4-45`).

So the best current explanation is:
1. **Primary cause:** transparent Electron window compositor / shadow invalidation behavior.
2. **Secondary amplifier:** Bonzi’s alpha WebGL renderer and fully transparent renderer tree, which can make avatar edges look darker/more silhouette-like than the bubble edges.
3. **Not primary:** a VRM-only outline/material bug, because that would not explain the shared artifact behind the DOM speech bubble.

## Recommendations
1. **Add a main-process opaque-window debug mode in `src/main/window.ts`.** Gate `transparent` and `backgroundColor` behind an env var so the app can run fully opaque for isolation. If the ghost behind both the avatar and bubble disappears in opaque mode, the transparent window compositor path is confirmed.
2. **Explicitly disable shadow handling in `src/main/window.ts`.** Add `hasShadow: false` to the `BrowserWindow` options and call `companionWindow.setHasShadow(false)` after construction, especially on macOS.
3. **Call `invalidateShadow()` when the transparent window is ready/shown.** On macOS, trigger it after `ready-to-show` / `did-finish-load` and potentially after resize/move transitions if needed.
4. **Add a GPU-disable debug toggle in `src/main/index.ts`.** A temporary `app.disableHardwareAcceleration()` path will help confirm whether GPU compositor behavior is involved.
5. **Treat renderer changes as secondary follow-up.** If the bubble ghost remains after window-level fixes, then revisit `src/renderer/vrm-stage.ts` for `premultipliedAlpha`, alpha-clear behavior, and tone-mapping adjustments.

## Preventive Measures
- Keep a built-in opaque-window debug mode for overlay investigations so Electron compositor artifacts can be isolated quickly.
- Centralize transparent-window policy in `src/main/window.ts` (shadow disable, invalidation hooks, debug toggles) instead of scattering diagnosis across renderer code.
- When investigating future rendering artifacts, first check whether they affect both DOM and WebGL; if they do, prioritize the shared window/compositing surface before digging into model-specific material logic.
