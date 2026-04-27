# Investigation: Bonzi Desktop Hitbox Drag Regression

## Summary
The drag failure is caused by a renderer-controlled whole-window click-through loop. After the speech bubble expires, a mousemove over non-avatar transparent space can set Electron `ignoreMouseEvents=true`; on macOS transparent windows the forwarded-mousemove recovery path is unreliable, so Bonzi may stop receiving the pointerdown needed to drag. A secondary issue is that expired invisible `.speech-bubble` content can remain pointer-targetable and block drag starts inside the old bubble rectangle.

## Symptoms
- User can see or interact with unexpected UI state around desktop mode.
- After a message box disappears, Bonzi can no longer be dragged.
- Previous attempts included VRM raycast hit testing, Electron `setIgnoreMouseEvents`, bubble visibility observation, and settings button hiding, but the issue persists.

## Background / Prior Research

### Electron `setIgnoreMouseEvents` behavior
- Official API: `BrowserWindow#setIgnoreMouseEvents(ignore, { forward })` is a whole-window toggle; `forward: true` is intended to forward mousemove events to Chromium only while `ignore=true` on macOS/Windows.
- External Electron issue history indicates `forward: true` is unreliable on macOS transparent/click-through windows. Once `ignore=true` is set, the renderer may stop receiving mousemove events, so it may never get the event needed to switch back to `ignore=false`.
- Relevant references reported by explore agent: Electron docs `BrowserWindow#setIgnoreMouseEvents`, Electron issues #27017, #26718, #23042, #15376, #30808, #38396, and Loom's native `ElectronMacOSClickThrough` workaround.
- Implication for Bonzi: a renderer-only loop of `ignore=true + forward=true -> wait for mousemove -> raycast -> ignore=false` is not reliable on macOS. It can strand the window in click-through mode.

### Git archaeology
- Commit `4f83276` (`Refine Bonzi desktop hit testing`) added VRM raycast hit testing, `canStartDrag`, `onDragStateChange`, and Electron mouse pass-through plumbing.
- `src/renderer/vrm-stage.ts` now returns `true` for visible VRM geometry, `false` for transparent stage space, and `null` when no avatar/canvas is available.
- `src/renderer/window-drag-controller.ts` gates pointerdown via `canStartDrag` and reports drag state.
- `src/renderer/styles.css` switched `.speech-bubble-shell` to `pointer-events: none` so transparent bubble container space no longer steals drag starts.
- Post-commit uncommitted changes added `setMouseEventsIgnored`, a bubble class `MutationObserver`, and settings button `hidden` gating.
- Earlier commit `8f64ae3` introduced `shell--bubble-visible` and initially made `.speech-bubble-shell { pointer-events: auto }`, which likely caused the original bubble overlay drag-box regression.

## Investigator Findings
<!-- Pair investigator appends structured analysis here. -->

### 2026-04-27 - Renderer/main hitbox drag regression trace

**Verdict:** The main hypothesis is supported. After bubble expiry, the renderer can put the whole transparent Electron window into click-through mode via `setIgnoreMouseEvents(true, { forward: true })`. Because drag starts require a renderer `pointerdown` on `.stage-shell`, any state that leaves the window ignored prevents the drag controller from starting. On macOS, the existing recovery path depends on forwarded `mousemove`, which prior research already flags as unreliable for transparent click-through windows.

#### Exact transition chain

1. Assistant command submission adds a user message and sets awaiting state in `src/renderer/assistant-command-controller.ts:46-47`, which renders conversation state via `src/renderer/conversation-controller.ts:279-281` and calls `onStateChanged` from `src/renderer/conversation-controller.ts:50-57`.
2. Assistant response handling appends the assistant turn in `src/renderer/assistant-command-controller.ts:52-67`; `addAssistantResponse()` renders in `src/renderer/conversation-controller.ts:299-319`; then the UI is hidden by `setUiVisible(false)` in `src/renderer/assistant-command-controller.ts:66-67`.
3. `onStateChanged` is wired to `syncBubbleWindowLayout()` in `src/renderer/app.ts:81-88`. That calls `bubbleWindowLayout.sync()` in `src/renderer/app.ts:56-65`.
4. `bubbleWindowLayout.sync()` refreshes bubble visibility, toggles shell classes, and schedules bounds sync in `src/renderer/bubble-window-layout.ts:171-176`. With an active assistant/system entry, `refreshBubbleVisibility()` sets `isBubbleVisible = true` and schedules `bubbleExpiryTimer` for `BUBBLE_EXPIRY_MS = 12000` in `src/renderer/bubble-window-layout.ts:6` and `src/renderer/bubble-window-layout.ts:139-160`.
5. While visible, `syncUiVisibility()` keeps `shell--bubble-visible` on the shell when UI, bubble, awaiting, or VRM-error state is true (`src/renderer/bubble-window-layout.ts:46-57`). `syncDesktopMouseEventMode()` treats that class as an explicit reason to force mouse events enabled (`src/renderer/app.ts:161-170`).
6. On expiry, the timer callback sets `isBubbleVisible = false`, calls `syncUiVisibility(lastArgs)`, and calls `syncWindowBoundsToBubble()` (`src/renderer/bubble-window-layout.ts:152-158`). That removes `shell--bubble-visible` synchronously, but the window resize is deferred through `requestAnimationFrame`, async `getBounds()`, and `setBounds()` (`src/renderer/bubble-window-layout.ts:116-132`, `src/renderer/bubble-window-layout.ts:57-113`).
7. The `MutationObserver` in `src/renderer/app.ts:192-203` sees the class transition and calls `setMouseEventsIgnored(false)` (`src/renderer/app.ts:196-199`). This is a real mouse-free reset, but it is only momentary: the next `mousemove` can immediately re-enter hit-test mode because the bubble-visible guard is now gone.
8. The window-level mousemove handler calls `syncDesktopMouseEventMode()` in `src/renderer/app.ts:275-277`. If UI/error/drag/bubble/explicit-interactive guards are all false, it raycasts with `vrmController.hitTestClientPoint()` and calls `setMouseEventsIgnored(hitTestResult === false)` (`src/renderer/app.ts:161-178`).
9. `setMouseEventsIgnored(true)` crosses preload at `src/preload/index.ts:70-77`, then main applies `BrowserWindow.setIgnoreMouseEvents(ignored, { forward: ignored })` in `src/main/ipc.ts:131-135`. Therefore `ignore=true` always uses `forward:true`.
10. Drag cannot recover this state by itself. `createWindowDragController()` listens for `pointerdown` on `.stage-shell` in `src/renderer/window-drag-controller.ts:94-98`, and only after successful pointerdown/getBounds does it call `onDragStateChange(true)` (`src/renderer/window-drag-controller.ts:25-61`). But while Electron ignores mouse events, the renderer does not receive the `pointerdown` needed to reach the reset in `src/renderer/app.ts:180-188`.

#### Reset paths after `ignore=true`

Search found only one IPC/main implementation for mouse ignoring: renderer `setMouseEventsIgnored()` in `src/renderer/app.ts:137-144`, preload forwarding in `src/preload/index.ts:70-77`, and main `setIgnoreMouseEvents()` in `src/main/ipc.ts:131-135`.

Mouse-free reset paths exist, but none is a durable post-expiry guard:

- UI visible or VRM error state in `syncBubbleWindowLayout()` calls `setMouseEventsIgnored(false)` (`src/renderer/app.ts:56-71`). This can recover if another conversation/VRM state change occurs, but it does not run continuously after expiry.
- Bubble class changes call `setMouseEventsIgnored(false)` via `MutationObserver` (`src/renderer/app.ts:192-203`). This fires on expiry, but can be immediately undone by the next post-expiry `mousemove` miss.
- Drag start calls `setMouseEventsIgnored(false)` through `onDragStateChange(true)` (`src/renderer/app.ts:180-188`), but this path is unreachable when the window is already click-through because `pointerdown` is not delivered to `src/renderer/window-drag-controller.ts:25-43`.
- `beforeunload` resets at `src/renderer/app.ts:381-389`, but that is cleanup, not runtime recovery.

The only normal runtime recovery while stranded is forwarded `mousemove` through Electron, exactly the path the hypothesis says is unreliable on macOS transparent windows.

#### VRM hit test and layout evidence

`hitTestClientPoint()` returns `null` only when disposed/no avatar or the canvas rect is zero-sized (`src/renderer/vrm-stage.ts:184-193`). `null` is safe: `syncDesktopMouseEventMode()` only ignores when `hitTestResult === false` (`src/renderer/app.ts:173-178`), and drag gating treats `null` as interactive via `?? true` (`src/renderer/app.ts:146-152`).

False is easy to produce after expiry because raycasting is against visible avatar geometry only: `hitTestClientPoint()` reads the current canvas rect, computes NDC, raycasts the avatar scene, and returns whether any visible material/object intersection exists (`src/renderer/vrm-stage.ts:184-207`, `src/renderer/vrm-stage.ts:256-309`). Any transparent stage space around the avatar returns `false` and triggers `ignore=true`.

Expiry can also create a short geometry mismatch window. With `shell--bubble-visible`, CSS pins the stage to `bottom: 12px` with `height: 462px` (`src/renderer/styles.css:108-112`). Without that class, hidden-UI stage layout changes to `top: 24px; bottom: 12px` (`src/renderer/styles.css:114-117`). The class changes synchronously in `src/renderer/bubble-window-layout.ts:152-157`, while OS bounds shrink is asynchronous (`src/renderer/bubble-window-layout.ts:116-132`). The VRM scene observes canvas resize and updates renderer/camera immediately via `ResizeObserver` and `resizeRenderer()` (`src/renderer/vrm-stage-scene.ts:42-53`, `src/renderer/vrm-stage-scene.ts:141-150`). A mousemove during this transition can therefore hit-test against new canvas/camera geometry before the user has a stable visual frame, increasing false misses.

#### CSS/DOM overlay findings

A separate overlay issue can also make Bonzi appear non-draggable even when Electron is not stranded. The DOM order is speech bubble shell before stage shell in `src/renderer/app-dom.ts:76-82`, with `.speech-bubble-shell` above stage via `z-index: 20` (`src/renderer/styles.css:482-493`). The shell container has `pointer-events: none` both by default and in hidden/visible bubble states (`src/renderer/styles.css:87-96`, `src/renderer/styles.css:482-493`), but the child `.speech-bubble` explicitly restores `pointer-events: auto` (`src/renderer/styles.css:509-512`). Since the bubble DOM content is not cleared on expiry, invisible bubble content can remain targetable over the stage.

If pointerdown targets that invisible `.speech-bubble`, the drag controller deliberately returns early for `.speech-bubble` ancestors (`src/renderer/window-drag-controller.ts:33-38`), so no drag starts. This does not falsify the Electron hypothesis; it is an additional, local overlay cause that can reproduce the same symptom inside the bubble's old box.

Eliminated overlay candidates:

- `.speech-bubble-shell` itself is not the blocker because it has `pointer-events: none` in the relevant states (`src/renderer/styles.css:87-96`, `src/renderer/styles.css:482-493`). The child `.speech-bubble` is the targetable element.
- `.command-dock`, `.titlebar`, and hidden titlebar/action children are disabled under `.shell--ui-hidden` (`src/renderer/styles.css:50-70`).
- `.stage-card__copy` is permanently `pointer-events: none` (`src/renderer/styles.css:421-431`).
- `.settings-panel` is a separate hidden `<aside>` in the app DOM (`src/renderer/app-dom.ts:38-63`) and is not implicated unless settings UI is open, which would also force mouse events enabled through UI-visible state.

#### Recommended fixes

1. Do not let renderer recovery from `ignore=true` depend solely on forwarded mousemove. Prefer a main-process or native-region strategy, or keep Electron mouse events enabled around the avatar/drag initiation path. At minimum, add a deterministic mouse-free reset/grace period after bubble expiry before allowing `syncDesktopMouseEventMode()` to set `ignore=true` again.
2. Make bubble expiry clear all pointer interception, not just the shell container. For example, state-condition `.speech-bubble` itself to `pointer-events: none` when `shell--bubble-visible` is absent, or clear/hide the bubble content so the old invisible bubble box cannot target pointerdown.
3. Debounce or defer VRM miss-based `ignore=true` during the expiry/layout resize transition. A short post-expiry grace period or waiting until bounds/canvas resize settles would avoid false misses created by synchronous class removal plus asynchronous window resize.
4. Consider making drag initiation tolerant of hit-test uncertainty: `null` is already safe, but a recent bubble-expiry/layout-change state could also treat `false` as non-authoritative until the next stable frame.
5. Add focused regression coverage for: bubble visible -> expiry -> pointerdown on avatar; pointerdown in the former bubble rectangle; and mousemove over transparent stage immediately after expiry on macOS/transparent-window configuration.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The regression is in the interaction between renderer-level VRM hit testing, Electron mouse-event pass-through, and bubble auto-expiry/window layout updates.
**Findings:** The issue appears temporally linked to the speech bubble disappearing, suggesting state transition or Electron mouse-event mode rather than raw drag math alone.
**Evidence:** User reports dragging works until the message box disappears, then dragging fails.
**Conclusion:** Needs workspace investigation plus Electron API behavior verification.

## Root Cause

The primary root cause is the post-bubble-expiry transition from always-interactive mode to renderer-controlled whole-window click-through mode.

While a bubble is visible, `syncDesktopMouseEventMode()` in `src/renderer/app.ts:160-170` sees `shell--bubble-visible` and forces `setMouseEventsIgnored(false)`. When the bubble expiry timer fires, `src/renderer/bubble-window-layout.ts:158-164` sets `isBubbleVisible = false`, calls `syncUiVisibility(lastArgs)`, and schedules bounds sync. That removes the bubble-visible guard. The next mousemove then raycasts against the VRM and calls `setMouseEventsIgnored(hitTestResult === false)` in `src/renderer/app.ts:172-178`.

A false VRM hit test is expected for transparent stage space: `src/renderer/vrm-stage.ts:184-207` raycasts only against visible avatar geometry. If that false result is sent, `src/main/ipc.ts:131-135` applies `BrowserWindow.setIgnoreMouseEvents(true, { forward: true })` to the whole window. Drag cannot recover this state because the drag controller only starts after a renderer `pointerdown` reaches `.stage-shell` (`src/renderer/window-drag-controller.ts:25-64`). Prior research found macOS forwarding while ignored is unreliable, so the renderer may never receive the mousemove/pointerdown needed to set ignore back to false.

The existing reset is real but not durable: `src/renderer/app.ts:192-203` observes bubble class changes and calls `setMouseEventsIgnored(false)`, but the first post-expiry mousemove can immediately set it back to true.

Secondary contributor: `.speech-bubble-shell` itself is not the blocker because it has `pointer-events: none`, but child `.speech-bubble` still has `pointer-events: auto` (`src/renderer/styles.css:482-512`). Since active bubble content is not cleared merely because the bubble auto-expired, invisible old bubble content can remain targetable over the stage; the drag controller explicitly returns early for `.speech-bubble` ancestors (`src/renderer/window-drag-controller.ts:33-38`).

### Eliminated / Lower-Probability Hypotheses

- Raw drag math is not the primary cause: failure can occur before `dragState` is created, because ignored windows do not deliver the needed `pointerdown`.
- `null` VRM hit tests are not the latch trigger: `src/renderer/app.ts:172-178` ignores only when the result is exactly `false`, while drag gating uses `?? true` at `src/renderer/app.ts:146-152`.
- `.speech-bubble-shell` as a container is mostly ruled out: CSS gives it `pointer-events: none` (`src/renderer/styles.css:482-493`). The child `.speech-bubble` is the remaining overlay issue.
- Current e2e tests do not validate this path because they launch with `BONZI_OPAQUE_WINDOW=1` and `BONZI_DISABLE_VRM=1` (`tests/e2e/bonzi.spec.ts:32-40`).

## Recommendations

1. **Remove or redesign renderer-driven whole-window click-through recovery.** Do not rely on `setIgnoreMouseEvents(true, { forward: true })` plus later renderer mousemove to recover on macOS. Fix locations: `src/renderer/app.ts`, `src/main/ipc.ts`, possibly `src/main/window.ts` if a native/main-process strategy is used.
2. **Add a deterministic post-bubble-expiry grace/settle period before allowing `ignore=true`.** When `shell--bubble-visible` is removed, force `ignore=false` and suppress miss-based ignore decisions until layout/window/canvas resize has settled. Fix locations: `src/renderer/app.ts` and/or `src/renderer/bubble-window-layout.ts`.
3. **Make expired bubble content non-interactive.** Ensure `.speech-bubble` itself has `pointer-events: none` whenever `shell--bubble-visible` is absent, or clear/hide/inert the bubble DOM on expiry. Fix locations: `src/renderer/styles.css`, `src/renderer/bubble-window-layout.ts`, and/or conversation rendering.
4. **Treat VRM hit-test misses during layout transitions as provisional.** A single false raycast immediately after bubble expiry should not be allowed to latch the whole window into click-through mode. Fix locations: `src/renderer/app.ts`, `src/renderer/vrm-stage.ts`, `src/renderer/vrm-stage-scene.ts`.
5. **Add targeted diagnostics before changing policy if uncertainty remains.** Log renderer mouse-ignore requests, main IPC receives, post-expiry mousemove delivery, VRM hit-test results, and drag pointerdown delivery to distinguish click-through latch from hit-test strictness.

## Preventive Measures

- Add a regression test/manual harness for: bubble visible → auto-expiry → pointerdown/drag on avatar.
- Add a case for pointerdown inside the former bubble rectangle after expiry to catch invisible overlay regressions.
- Maintain at least one transparent-window + real-VRM manual or automated check; existing e2e uses opaque/no-VRM mode and cannot catch this class of bug.
- Avoid whole-window `ignoreMouseEvents` state machines that depend on renderer mousemove events for recovery on macOS transparent windows.
- If pass-through remains necessary, track the authoritative state in main and add a non-mouse recovery path or timeout so ignored state cannot persist indefinitely.
