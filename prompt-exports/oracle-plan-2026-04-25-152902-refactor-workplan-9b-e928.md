## Final Prompt
<taskname="Refactor Workplan"/>
<task>Produce an implementation plan (not code changes) for a coordinated Bonzi Electron refactor using sub-agents. Cap the plan at <=5 work items, include dependency ordering, and define verification criteria per item. Prioritize low-overlap assignments. Required priority candidates: split renderer coordinator in src/renderer/app.ts, split plugin discovery registry/cache/merge normalization in src/main/eliza/plugin-discovery.ts, extract workflow state transitions/approval logic from src/main/eliza/workflow-manager.ts, split plugin settings vs approval settings in src/renderer/settings-panel-controller.ts, and introduce a typed IPC channel registry spanning src/main/ipc.ts + src/preload/index.ts + src/shared/contracts.ts (and related renderer typings). Optional later candidates: src/main/cua-driver.ts, src/renderer/vrm-animation-clips.ts, broader contracts domain split.</task>

<architecture>Main process orchestration starts in src/main/index.ts, which wires AssistantService and registerIpcHandlers. AssistantService (src/main/assistant.ts) delegates runtime/plugin/workflow behavior to BonziRuntimeManager (src/main/eliza/runtime-manager.ts). RuntimeManager composes plugin settings/discovery/install/runtime resolution and workflow management. Renderer bootstrap is src/renderer/main.ts -> renderApp in src/renderer/app.ts, with settings behavior delegated to src/renderer/settings-panel-controller.ts and conversation rendering in src/renderer/conversation-view.ts. IPC contract surface is currently string-literal based and duplicated across main/preload/renderer typing surfaces.</architecture>

<selected_context>
src/main/index.ts: app bootstrap, assistant:event forwarding, ipc registration entrypoint.
src/main/ipc.ts: all ipcMain.handle/ipcMain.on channel declarations and request typing.
src/preload/index.ts: bonziApi bridge with ipcRenderer.invoke/send string-literal channels.
src/renderer/global.d.ts: renderer-side bonzi bridge type contract mirroring preload API.
src/shared/contracts.ts: shared request/response/event/domain types used by main/preload/renderer.
src/main/assistant.ts: AssistantService interface and request normalization before runtime manager calls.
src/main/shell-state.ts: shell state assembly including approval settings projection.

src/renderer/app.ts: large renderer coordinator (UI state, event wiring, shell hydration, conversation/workflow/action handling, settings integration, VRM lifecycle).
src/renderer/settings-panel-controller.ts: mixed concerns (plugin discovery/install/uninstall/toggle + approval toggle + runtime reload UI state).
src/renderer/conversation-view.ts: workflow/action rendering and approval/cancel button contract.
src/renderer/app-dom.ts: mounted DOM element contract consumed by app/settings controller.
src/renderer/plugin-settings-view.ts: plugin row rendering and data-* action hooks.
src/renderer/app-shell-state.ts: runtime-state to shell-stage mapping helpers.
src/renderer/bubble-window-layout.ts: bubble/window sizing behavior used by app coordinator.
src/renderer/window-drag-controller.ts: drag behavior integration point.
src/renderer/vrm-stage.ts: VRM stage interface used by app coordinator.

src/main/eliza/runtime-manager.ts: composes pluginDiscovery/pluginInstallation/pluginRuntimeResolver/workflowManager and exposes workflow/plugin methods consumed via AssistantService.
src/main/eliza/plugin-discovery.ts: discovery pipeline (persisted settings + registry fetch/cache + normalization + merge + inventory/warnings).
src/main/eliza/plugin-installer.ts: install/uninstall operations + confirmation workflow + operation history.
src/main/eliza/plugin-runtime-resolver.ts: loads enabled external plugins, instruments actions with workflow manager.
src/main/eliza/plugin-settings.ts: persisted plugin inventory + approvals settings store and update APIs.
src/main/eliza/plugin-settings-model.ts: persisted settings schema/types.
src/main/eliza/plugin-settings-normalization.ts: parsing/canonicalization/defaulting/validation utilities.
src/main/eliza/plugin-settings-projection.ts: projection from normalized inventory to exposed settings.
src/main/eliza/runtime-bootstrap.ts: runtime plugin assembly and runtime config signature.

src/main/eliza/workflow-manager.ts: run lifecycle, step transitions, approval requests/responses, cancellation, persistence updates.
src/main/eliza/workflow-snapshot-utils.ts: workflow limits, status normalization, clone/terminal helpers.
src/main/eliza/workflow-persistence.ts: persisted run load/save.
src/main/eliza/workflow-action-instrumentation.ts: plugin action wrapping that drives workflow manager transitions and approvals.

tests/e2e/bonzi.spec.ts: current behavior coverage for shell boot, plugin settings, approvals toggle, discovery via preload, and partial workflow TODO coverage.
src/shared/value-utils.ts: shared normalization helpers used across plugin/workflow code.
</selected_context>

<relationships>
- src/main/index.ts -> registerIpcHandlers(src/main/ipc.ts) -> AssistantService(src/main/assistant.ts) -> BonziRuntimeManager(src/main/eliza/runtime-manager.ts).
- src/main/ipc.ts channel handlers map directly to methods exposed in src/preload/index.ts bonziApi; renderer consumes via window.bonzi and src/renderer/global.d.ts.
- src/renderer/main.ts -> renderApp(src/renderer/app.ts) -> createSettingsPanelController(src/renderer/settings-panel-controller.ts) and renderConversation(src/renderer/conversation-view.ts).
- src/renderer/settings-panel-controller.ts calls window.bonzi.settings/plugins/assistant APIs that terminate in ipc.ts handlers.
- BonziRuntimeManager composes BonziPluginDiscoveryService + BonziPluginInstallationService + BonziPluginRuntimeResolver + BonziWorkflowManager; these are the core main-process refactor seams.
- BonziPluginRuntimeResolver instruments plugin actions through workflow-action-instrumentation.ts, which depends on BonziWorkflowManager transition/approval behavior.
- Workflow UI controls in conversation-view.ts (approve/decline/cancel data attributes) depend on workflow state semantics from workflow-manager.ts and assistant IPC methods.
- Plugin settings persistence + normalization/projection modules define data contracts consumed by plugin-discovery.ts merge behavior.
</relationships>

<ambiguities>
- The typed IPC registry target shape is not yet defined: could be channel constants only, channel->request/response map, or helper wrappers; all three currently duplicate literals in main/preload/global typings.
- workflow-manager.ts and workflow-action-instrumentation.ts both encode approval/transition assumptions; extraction boundaries need care to avoid behavioral drift.
- settings-panel-controller.ts currently couples plugin operations and approval operations through shared UI status/reload-pending state; split boundary may require a small shared state adapter.
</ambiguities>

## Selection
- Files: 36 total (32 full, 4 codemap)
- Total tokens: 83943 (Auto view)
- Token breakdown: full 82597, codemap 1346

### Files
### Selected Files
/Users/t3rpz/projects/bonzi/
├── src/
│   ├── main/
│   │   ├── eliza/
│   │   │   ├── config.ts — 2,868 tokens (full)
│   │   │   ├── plugin-discovery.ts — 6,787 tokens (full)
│   │   │   ├── plugin-installer.ts — 5,573 tokens (full)
│   │   │   ├── plugin-runtime-resolver.ts — 2,154 tokens (full)
│   │   │   ├── plugin-settings-model.ts — 702 tokens (full)
│   │   │   ├── plugin-settings-normalization.ts — 3,870 tokens (full)
│   │   │   ├── plugin-settings-projection.ts — 1,273 tokens (full)
│   │   │   ├── plugin-settings.ts — 2,951 tokens (full)
│   │   │   ├── runtime-bootstrap.ts — 2,111 tokens (full)
│   │   │   ├── runtime-manager.ts — 5,210 tokens (full)
│   │   │   ├── workflow-action-instrumentation.ts — 2,989 tokens (full)
│   │   │   ├── workflow-manager.ts — 5,699 tokens (full)
│   │   │   ├── workflow-persistence.ts — 522 tokens (full)
│   │   │   └── workflow-snapshot-utils.ts — 2,092 tokens (full)
│   │   ├── assistant.ts — 3,758 tokens (full)
│   │   ├── index.ts — 610 tokens (full)
│   │   ├── ipc.ts — 1,429 tokens (full)
│   │   └── shell-state.ts — 424 tokens (full)
│   ├── preload/
│   │   └── index.ts — 1,115 tokens (full)
│   ├── renderer/
│   │   ├── app-dom.ts — 1,932 tokens (full)
│   │   ├── app-shell-state.ts — 124 tokens (full)
│   │   ├── app.ts — 4,710 tokens (full)
│   │   ├── bubble-window-layout.ts — 1,261 tokens (full)
│   │   ├── conversation-view.ts — 3,300 tokens (full)
│   │   ├── global.d.ts — 774 tokens (full)
│   │   ├── plugin-settings-view.ts — 2,359 tokens (full)
│   │   ├── settings-panel-controller.ts — 5,298 tokens (full)
│   │   ├── vrm-stage.ts — 1,589 tokens (full)
│   │   └── window-drag-controller.ts — 634 tokens (full)
│   └── shared/
│       ├── contracts.ts — 2,239 tokens (full)
│       └── value-utils.ts — 181 tokens (full)
└── tests/
    └── e2e/
        └── bonzi.spec.ts — 6,059 tokens (full)

### Codemaps
/Users/t3rpz/projects/bonzi/
└── src/
    └── main/
        ├── eliza/
        │   ├── embedding-dimensions.ts — 248 tokens (auto)
        │   └── external-embeddings-service.ts — 316 tokens (auto)
        ├── assistant-action-executor.ts — 319 tokens (auto)
        └── vision-client.ts — 463 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `refactor-workplan-9BDF88` | **Mode**: plan

### Response
## 1. **Summary**

Refactor Bonzi with five low-overlap sub-agent work items: typed IPC registry, plugin discovery decomposition, workflow manager state extraction, renderer settings-panel split, and renderer app coordinator split. The goal is behavior-preserving modularization with stable IPC/window bridge contracts, unchanged persistence schemas, unchanged renderer DOM/data-attribute behavior, and targeted verification per item. Implement typed IPC first as the contract foundation; main-process plugin/workflow refactors can then proceed independently; renderer settings split should land before the larger `app.ts` coordinator split.

---

## 2. **Current-state analysis**

Bonzi currently starts in `src/main/index.ts`, creates `AssistantService`, registers IPC handlers in `src/main/ipc.ts`, forwards `assistant:event` to the renderer, and opens the companion window. `AssistantService` in `src/main/assistant.ts` normalizes requests and delegates runtime, plugin, approval, workflow, and action behavior to `BonziRuntimeManager`.

`BonziRuntimeManager` composes:

- `BonziPluginSettingsStore` for persisted plugin inventory and approval settings.
- `BonziPluginDiscoveryService` for installed/available/inventory projection plus registry fetch/cache/normalization/merge.
- `BonziPluginInstallationService` for install/uninstall operations.
- `BonziPluginRuntimeResolver` for loading external enabled plugins.
- `BonziWorkflowManager` for workflow run state, step transitions, approvals, cancellation, persistence, and event emission.

Renderer bootstrap is `src/renderer/main.ts -> renderApp()` in `src/renderer/app.ts`. `app.ts` currently owns shell hydration, conversation state, workflow update reconciliation, action execution, settings integration, VRM lifecycle, event subscriptions, window dragging, and bubble sizing. Settings UI behavior is partly delegated to `settings-panel-controller.ts`, but that controller mixes plugin operations, approval toggles, runtime reload state, and shared status text.

IPC is duplicated across:

- `src/main/ipc.ts` string-literal `ipcMain.handle/on`.
- `src/preload/index.ts` string-literal `ipcRenderer.invoke/send`.
- `src/renderer/global.d.ts` hand-maintained `window.bonzi` shape.
- `src/shared/contracts.ts` request/response/domain types.

Important constraints:

- Do not change persisted schemas: `bonzi-settings.json`, registry cache, and workflow runs remain compatible.
- Do not change renderer data attributes used by tests and UI delegation, especially plugin rows, workflow controls, action chips, and settings toggles.
- `BonziWorkflowManager` approval semantics must remain unchanged: approvals can timeout, disabling approvals auto-approves pending approvals, cancellation resolves pending approvals as declined.
- `AsyncLocalStorage` active workflow run behavior must remain intact for `workflow-action-instrumentation.ts`.
- `window.bonzi` public renderer API should remain source-compatible unless changed by the typed IPC item in an additive/internal-only way.

This should be handled as coordinated targeted refactors, not a broad architectural rewrite. Each item extracts existing responsibilities into smaller modules while preserving contracts.

---

## 3. **Design**

### Work item 1 — Typed IPC channel registry

**Sub-agent:** IPC Contract Agent  
**Dependencies:** None. Should land first.

#### Scope

Introduce a shared typed IPC registry spanning:

- `src/shared/contracts.ts`
- new shared IPC contract module, preferably `src/shared/ipc-contracts.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/global.d.ts`

#### Design

Create a single source of truth for IPC channel names and request/response mapping.

Partial shape:

```ts
type InvokeChannelMap = {
  'app:get-shell-state': {
    request: void
    response: ShellState
  }
  'assistant:send-command': {
    request: AssistantCommandRequest
    response: AssistantCommandResponse
  }
  // ...
}

type SendChannelMap = {
  'window:minimize': {
    args: []
  }
  'window:set-position': {
    args: [x: number, y: number]
  }
}
```

Also define constants or a typed object for channel names so `ipc.ts` and `preload/index.ts` no longer repeat raw literals.

Keep `window.bonzi` API unchanged:

```ts
window.bonzi.assistant.sendCommand({ command })
window.bonzi.plugins.discover({ forceRefresh: true })
```

The registry types should improve implementation safety without forcing renderer call-site churn.

#### Verification criteria

- TypeScript compile passes.
- Existing E2E tests still pass without renderer API changes.
- No remaining raw IPC channel literals in `src/main/ipc.ts` or `src/preload/index.ts` except inside the registry definition.
- `global.d.ts` bridge shape remains assignable to the preload implementation.

---

### Work item 2 — Split plugin discovery registry/cache/normalization/merge

**Sub-agent:** Plugin Discovery Agent  
**Dependencies:** Can run after item 1, but does not depend on renderer work.

#### Scope

Refactor `src/main/eliza/plugin-discovery.ts` into focused modules while preserving `BonziPluginDiscoveryService.discover()` behavior.

Proposed files:

- `src/main/eliza/plugin-discovery.ts` — orchestration only.
- `src/main/eliza/plugin-registry-cache.ts` — cache read/write/freshness.
- `src/main/eliza/plugin-registry-client.ts` — fetch with timeout and fallback-to-cache behavior.
- `src/main/eliza/plugin-registry-normalization.ts` — `normalizeRegistryPayload`, entry normalization helpers.
- `src/main/eliza/plugin-discovery-merge.ts` — installed/available/inventory merge and sorting.

#### Design

`BonziPluginDiscoveryService.discover(provider, request)` remains the public entry point. It should:

1. Read projected settings from `settingsStore.getSettings(provider)`.
2. Read persisted inventory snapshot.
3. Build base installed/available/inventory maps.
4. Load registry entries through `PluginRegistryClient`.
5. Merge registry metadata through pure merge helpers.
6. Return `ElizaPluginSettings`.

Keep these data contracts unchanged:

- `ElizaPluginSettings`
- `ElizaInstalledPluginEntry`
- `ElizaAvailablePluginEntry`
- `ElizaPluginInventoryEntry`
- registry cache file name and schema version.

#### Verification criteria

- Existing registry E2E test still passes:
  - discovery via preload returns registry plugin.
  - incompatible plugin remains marked `incompatible`.
  - cache file `eliza-plugin-registry-cache.v1.json` is written with schema version `1`.
- Add focused unit tests if the project has a unit-test convention; otherwise extend E2E minimally only if necessary.
- Behavior remains stable when registry fetch fails:
  - uses fresh cache when available.
  - returns local-only plugin settings with warning when no cache exists.

---

### Work item 3 — Extract workflow state transitions and approval logic

**Sub-agent:** Workflow State Agent  
**Dependencies:** Can run after item 1. Must coordinate with item 2 only through `runtime-manager.ts`, but no direct overlap expected.

#### Scope

Refactor `src/main/eliza/workflow-manager.ts` so it delegates pure state mutations and approval bookkeeping to smaller modules while preserving public methods used by:

- `src/main/eliza/runtime-manager.ts`
- `src/main/eliza/workflow-action-instrumentation.ts`
- `src/main/assistant.ts`

Proposed files:

- `src/main/eliza/workflow-manager.ts` — public facade, persistence, listeners, active run storage.
- `src/main/eliza/workflow-state-transitions.ts` — pure run/step transition functions.
- `src/main/eliza/workflow-approval-coordinator.ts` — pending approval map, timeout, auto-approval, cancellation resolution.
- Existing `workflow-snapshot-utils.ts` remains shared utility layer.

#### Design

Keep `BonziWorkflowManager` public interface stable:

- `createRun`
- `runWithActiveRun`
- `getActiveRunId`
- `startStep`
- `runStep`
- `completeStep`
- `failStep`
- `skipStep`
- `requestStepApproval`
- `setApprovalsEnabled`
- `respondToApproval`
- `cancelRun`
- `recordCallback`
- `completeRun`
- `failRun`
- `getRuns`
- `getRun`
- `subscribe`
- `dispose`

Extract pure transitions as functions that accept cloned snapshots and return next snapshots.

Partial shape:

```ts
type TransitionContext = {
  nowIso: string
}

function transitionStepStatus(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; status: BonziWorkflowStepStatus; detail?: string },
  context: TransitionContext
): BonziWorkflowRunSnapshot
```

Approval coordinator should own:

- `pendingApprovals: Map<string, PendingApprovalEntry>`
- timeout creation/cleanup
- resolving pending promises
- approving all pending approvals when approvals are disabled
- resolving pending approvals as `false` on cancellation/dispose

`BonziWorkflowManager` remains responsible for calling `updateRun()` so persistence, pruning, revision increments, and listener emission stay centralized.

#### Verification criteria

- Existing approval E2E tests pass:
  - disabling approvals persists.
  - auto-runs action cards.
- Workflow behavior remains unchanged for:
  - approval timeout resolves false.
  - `setApprovalsEnabled(false)` auto-approves pending approvals.
  - `cancelRun()` marks non-terminal steps cancelled and resolves pending approvals false.
  - startup marks active runs interrupted.
- Add or preserve tests for persisted workflow load/save if available; otherwise validate by running a manual/e2e workflow scenario once `BONZI_E2E_MODE` can emit workflow snapshots.

---

### Work item 4 — Split plugin settings vs approval settings controller

**Sub-agent:** Renderer Settings Agent  
**Dependencies:** Should run after item 1. Should land before item 5 to reduce `app.ts` split complexity.

#### Scope

Split `src/renderer/settings-panel-controller.ts` into separate controllers for plugin settings, approval settings, and shared panel shell/status.

Proposed files:

- `src/renderer/settings-panel-controller.ts` — composition facade preserving current exported `SettingsPanelController`.
- `src/renderer/plugin-settings-controller.ts` — plugin discovery/update/install/uninstall/runtime reload pending integration.
- `src/renderer/approval-settings-controller.ts` — approval toggle rendering/update/confirmation.
- Optional small helper: `src/renderer/settings-status-controller.ts` for shared status text and apply-runtime-changes button state.

Do not change `plugin-settings-view.ts` DOM output unless required.

#### Design

Keep the existing public `createSettingsPanelController(options)` interface stable for `app.ts`.

Internally:

- Plugin controller owns:
  - `pluginSettings`
  - `pendingPluginInstallConfirmations`
  - `isSavingSettings`
  - plugin hydrate/discover/install/uninstall/toggle
  - calls `onApplyShellState`
  - marks runtime reload pending for plugin changes

- Approval controller owns:
  - `approvalSettings`
  - `isSavingApprovalSettings`
  - approval hydrate/toggle/confirmation
  - calls `onApprovalSettingsChanged`, `onApprovalsDisabled`, `onConversationNeedsRender`

- Panel facade owns:
  - visible/hidden state
  - settings open/close buttons
  - apply runtime changes button
  - shared status text
  - dispose aggregation

The returned API remains:

```ts
interface SettingsPanelController {
  setVisible(visible: boolean): void
  toggleVisible(): void
  hydratePluginSettings(...): Promise<void>
  hydrateApprovalSettings(): Promise<void>
  setPluginSettings(settings: ElizaPluginSettings | null): void
  syncApprovalSettings(settings: RuntimeApprovalSettings | null): void
  getApprovalSettings(): RuntimeApprovalSettings | null
  isApprovalsEnabled(): boolean
  setRuntimeReloadPending(pending: boolean): void
  dispose(): void
}
```

#### Verification criteria

- Existing E2E tests pass:
  - bundled plugin add/remove/toggle.
  - approval toggle with explicit disable confirmation.
  - auto-run action cards when approvals disabled.
  - plugin discovery rows render from registry.
- Settings panel status text still shows:
  - save/install/uninstall progress.
  - runtime reload pending message.
  - reload completion/failure.
- No change to data attributes:
  - `data-plugin-toggle`
  - `data-plugin-add`
  - `data-plugin-remove`
  - `data-plugin-install`
  - `data-plugin-uninstall`
  - `data-approval-toggle`
  - `data-action="apply-runtime-changes"`

---

### Work item 5 — Split renderer coordinator in `src/renderer/app.ts`

**Sub-agent:** Renderer Coordinator Agent  
**Dependencies:** Must run after item 4. Should not overlap with items 2 or 3.

#### Scope

Refactor `src/renderer/app.ts` into smaller renderer coordination modules while preserving `renderApp(root)` as the entry point.

Proposed files:

- `src/renderer/app.ts` — top-level composition only.
- `src/renderer/shell-state-controller.ts` — shell state, provider labels, runtime status sync.
- `src/renderer/conversation-controller.ts` — conversation array, pending confirmations, action execution, workflow update reconciliation, render calls.
- `src/renderer/assistant-event-controller.ts` — `window.bonzi.assistant.onEvent` dispatch.
- `src/renderer/assistant-command-controller.ts` — chat form submit flow.
- `src/renderer/vrm-controller.ts` or reuse existing `vrm-stage.ts` with a thin app integration helper.

#### Design

Keep `renderApp(root)` behavior stable:

1. Mount DOM via `mountAppDom`.
2. Create shell/conversation/settings/VRM/bubble/window-drag controllers.
3. Subscribe to assistant events.
4. Hydrate shell state and history.
5. Enable input and load VRM.
6. Dispose all controllers on `beforeunload`.

Conversation controller should own:

- `conversation: ConversationEntry[]`
- `workflowRunsById`
- `pendingConfirmations`
- `isAwaitingAssistant`
- `isUiVisible` can remain in app shell if needed, but renderer decisions should be centralized.
- `rerenderConversation()`
- `applyWorkflowRunUpdate()`
- `autoRunPendingActionCards()`

Shell state controller should own:

- current `ShellState | null`
- pending runtime status
- `applyShellState`
- `syncRuntimeStatus`
- provider label elements
- shell JSON/debug text

Assistant command controller should call existing `window.bonzi.assistant.sendCommand`, then update conversation through methods rather than directly mutating arrays.

Do not modify presentational modules unless necessary:

- `conversation-view.ts`
- `bubble-window-layout.ts`
- `window-drag-controller.ts`
- `vrm-stage.ts`

#### Verification criteria

- Existing E2E boot and roundtrip test passes.
- Existing settings/plugin/approval tests pass.
- Existing VRM-disabled E2E path still reaches `.shell[data-app-ready="ready"]`.
- Manual smoke criteria:
  - double-click stage toggles command UI.
  - Escape hides settings and command UI.
  - assistant events update runtime status and workflow cards.
  - action card confirmation flow still works.

---

## 4. **File-by-file impact**

### `src/shared/contracts.ts`

- Add or re-export typed IPC request/response map types only if the team chooses to colocate IPC types here.
- Prefer keeping domain types here and putting channel registry in `src/shared/ipc-contracts.ts`.

### `src/shared/ipc-contracts.ts` **new**

- Add invoke/send channel registry types and channel constants.
- Dependency: item 1.

### `src/main/ipc.ts`

- Replace raw channel strings with typed registry constants/helpers.
- Keep handler behavior and normalization unchanged.
- Dependency: item 1.

### `src/preload/index.ts`

- Replace raw `ipcRenderer.invoke/send` literals with typed channel constants/helpers.
- Keep `bonziApi` shape unchanged.
- Dependency: item 1.

### `src/renderer/global.d.ts`

- Reuse shared bridge/API types where practical.
- Avoid hand-divergence from preload implementation.
- Dependency: item 1.

### `src/main/eliza/plugin-discovery.ts`

- Reduce to orchestration service.
- Move cache/client/normalization/merge logic to new modules.
- Dependency: item 2.

### New plugin discovery modules

- `plugin-registry-cache.ts`
- `plugin-registry-client.ts`
- `plugin-registry-normalization.ts`
- `plugin-discovery-merge.ts`

Each owns one extracted responsibility from current `plugin-discovery.ts`.

### `src/main/eliza/workflow-manager.ts`

- Remains public facade.
- Delegates transition and approval logic to extracted modules.
- Keeps persistence/listener/revision behavior centralized.
- Dependency: item 3.

### New workflow modules

- `workflow-state-transitions.ts`
- `workflow-approval-coordinator.ts`

Contain pure transition functions and approval pending-promise lifecycle.

### `src/main/eliza/workflow-action-instrumentation.ts`

- Should not change public usage.
- Validate compile if workflow manager method signatures remain stable.
- Dependency: item 3 validation only.

### `src/renderer/settings-panel-controller.ts`

- Becomes facade/composition layer.
- Moves plugin and approval logic into dedicated controllers.
- Dependency: item 4.

### New renderer settings modules

- `plugin-settings-controller.ts`
- `approval-settings-controller.ts`
- Optional `settings-status-controller.ts`

### `src/renderer/app.ts`

- Becomes renderer composition root.
- Extract shell/conversation/event/command coordination.
- Dependency: item 5, after item 4.

### New renderer app coordination modules

- `shell-state-controller.ts`
- `conversation-controller.ts`
- `assistant-event-controller.ts`
- `assistant-command-controller.ts`
- Optional `vrm-controller.ts`

### `tests/e2e/bonzi.spec.ts`

- No required test rewrites unless selectors break, which should be treated as a regression.
- Optional: convert existing workflow `fixme` once E2E workflow event support exists, but that is not required for this refactor.

---

## 5. **Risks and migration**

- **IPC registry risk:** accidental bridge API drift. Mitigate by keeping `window.bonzi` shape unchanged and verifying existing E2E tests.
- **Workflow extraction risk:** subtle approval/cancellation behavior drift. Mitigate by keeping `updateRun()` in `BonziWorkflowManager` and extracting pure transitions with unchanged inputs/outputs.
- **Plugin discovery risk:** merge order or warning dedupe changes. Mitigate by snapshot-like tests around registry discovery, incompatible entries, cache fallback, and installed/available sorting.
- **Renderer split risk:** lifecycle ordering bugs around settings hydration, assistant events, and VRM loading. Mitigate by preserving `renderApp()` initialization sequence and landing settings split first.
- **Persistence migration:** no schema migration should be introduced. Existing settings, registry cache, and workflow persistence schemas remain unchanged.

---

## Orchestrator progress

- [x] Item 1 — Typed IPC channel registry — completed by session 161CE74D; `bun run typecheck` passed; IPC literals centralized in `src/shared/ipc-contracts.ts`.
- [x] Item 2 — Plugin discovery decomposition — completed by session 8BDC41AB; extracted cache/client/normalization/merge modules; consolidated `bun run typecheck` passed.
- [x] Item 3 — Workflow state/approval extraction — completed by session 4AB0F1BE; extracted state transitions and approval coordinator; `bun run typecheck` passed.
- [x] Item 4 — Renderer settings controller split — completed by session 056F5983; split plugin/approval/status controllers; consolidated `bun run typecheck` passed.
- [x] Item 5 — Renderer app coordinator split — completed by session 2A4FCFAE; extracted command/event/conversation/shell/VRM controllers; final `bun run typecheck` passed.

Final verification: `bun run typecheck` passed and `bun run test:e2e` passed (8 passed, 1 skipped).

## 6. **Implementation order**

1. **IPC Contract Agent:** Add typed IPC registry and update `ipc.ts`, `preload/index.ts`, and `global.d.ts`.  
   Atomic: registry + main/preload compile changes should land together.

2. **Plugin Discovery Agent:** Split `plugin-discovery.ts` into registry cache/client/normalization/merge modules.  
   Can run in parallel with item 3 after item 1.

3. **Workflow State Agent:** Extract workflow transitions and approval coordinator from `workflow-manager.ts`.  
   Can run in parallel with item 2 after item 1.

4. **Renderer Settings Agent:** Split `settings-panel-controller.ts` into plugin/approval/shared status controllers while preserving facade API.  
   Should land before item 5.

5. **Renderer Coordinator Agent:** Split `app.ts` into shell, conversation, assistant command/event, and VRM integration controllers.  
   Depends on item 4 and should be the final refactor because it has the broadest renderer coordination surface.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "refactor-workplan-9BDF88", new_chat: false)