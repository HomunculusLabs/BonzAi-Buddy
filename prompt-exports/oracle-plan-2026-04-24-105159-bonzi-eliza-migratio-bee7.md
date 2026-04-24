## Final Prompt

## Orchestrator Work Items
- [x] Item 1 — Eliza foundation: Bonzi-side Eliza runtime files landed (`src/main/eliza/config.ts`, `bonzi-character.ts`, `bonzi-context-plugin.ts`, `runtime-manager.ts`), additive shared contract/preload/global type updates landed, and `package.json`/`package-lock.json` now include the minimum Eliza packages. Verified with `npm run typecheck` and `npm run build`. Note: published npm packages available here are `2.0.0-alpha.3`, not the local reference repo’s `2.0.0-alpha.344`.
- [x] Item 2 — Main-process cutover: `src/main/assistant.ts` now uses `BonziRuntimeManager`, `src/main/ipc.ts` injects the assistant service and exposes `assistant:get-history` / `assistant:reset-conversation`, `src/main/index.ts` owns assistant lifecycle + event forwarding, and `src/main/shell-state.ts` derives coherent runtime-backed shell state. Verified with `npm run typecheck` and `npm run build`.
- [x] Item 3 — Renderer + companion wiring: `src/renderer/app.ts` now hydrates from runtime-backed history and consumes `assistant:event`, `src/renderer/vrm-stage.ts` exposes `playBuiltInEmote(...)`, and the event path now supports Bonzi built-in emotes while preserving the existing action-chip UX. Verified with `npm run typecheck` and `npm run build`.
- [x] Item 4 — Docs + hardening: `README.md` and `.env.example` now describe the embedded Eliza runtime, runtime-backed history, provider mapping, and current built-in emotes/action model; stale public `mock` provider output typing was removed from `src/shared/contracts.ts`, and `src/main/eliza/config.ts` now warns on invalid provider values while still accepting legacy `mock` as input. Verified with `npm run typecheck` and `npm run build`.

<taskname="Bonzi Eliza Migration"/>
<task>Produce a concrete, incremental implementation plan to refactor Bonzi from its current custom assistant backend into an ElizaOS-powered desktop companion, while preserving Bonzi’s existing renderer/avatar UI initially. The plan must cover: target architecture, migration phases, file/module changes per phase, IPC/data-contract evolution, dependency/runtime setup, and execution order that minimizes breakage.</task>

<architecture>
- Bonzi today:
  - Electron main process owns assistant orchestration in `src/main/assistant.ts` and IPC in `src/main/ipc.ts`.
  - Preload bridge in `src/preload/index.ts`; renderer consumes typed API from `src/renderer/global.d.ts`.
  - Shared command/action/shell contracts are in `src/shared/contracts.ts`.
  - Renderer chat + VRM stage lifecycle are in `src/renderer/app.ts` and `src/renderer/vrm-stage.ts` with animation helpers.
- Eliza Electron reference:
  - `packages/examples/app/electron/backend/src/runtimeManager.ts` shows `AgentRuntime` creation, plugin selection, runtime reuse, memory-backed history, and message handling.
  - `.../ipc.ts` and `.../preload.ts` show minimal Electron bridge pattern for chat methods.
- Eliza runtime internals:
  - `packages/agent/src/runtime/eliza.ts` is the canonical startup path (plugin map, config/env application, boot/runtime lifecycle).
  - `packages/agent/src/runtime/plugin-lifecycle.ts` handles plugin ownership, dynamic registration/teardown, and lifecycle hooks.
  - `core-plugins.ts`, `eliza-plugin.ts`, `plugin-types.ts`, and `services/app-session-gate.ts` define core plugin defaults and hosted-app gating behavior.
- Companion/avatar and voice references:
  - `apps/app-companion/src/plugin.ts` + `actions/emote.ts` + `emotes/catalog.ts` define PLAY_EMOTE plugin behavior.
  - `packages/agent/src/api/misc-routes.ts` exposes `/api/emotes` and `/api/emote` HTTP bridge used by companion emote action.
  - `apps/app-companion/src/components/companion/VrmStage.tsx` and related files show companion-stage responsibilities.
  - `packages/native-plugins/talkmode/src/definitions.ts` defines talk mode STT/TTS interfaces and events.
</architecture>

<selected_context>
bonzi/src/main/assistant.ts: Current provider-pluggable assistant service (`mock` + `openai-compatible`), JSON action proposal normalization, pending action lifecycle, allowlisted action execution.
bonzi/src/main/ipc.ts: Registers current IPC API (`app:get-shell-state`, `assistant:send-command`, `assistant:execute-action`, window controls).
bonzi/src/preload/index.ts: Exposes `window.bonzi` bridge used by renderer.
bonzi/src/shared/contracts.ts: Canonical assistant/request/response/action/shell-state types.
bonzi/src/main/shell-state.ts: Current shell metadata payload (stage, provider info, available actions).
bonzi/src/renderer/app.ts: Speech-bubble chat UX, command submission, action confirmation flow, shell-state hydration, and VRM stage mounting.
bonzi/src/renderer/vrm-stage.ts: Persistent VRM runtime, idle/emote animation loop, pointer reaction, load/error lifecycle.
bonzi/src/renderer/vrma-animation-resolver.ts + vrm-animation-clips.ts + mixamo-animation-loader.ts: Current animation source pipeline and fallback strategy.
bonzi/src/main/window.ts + src/main/index.ts: Companion window boot/lifecycle.
bonzi/src/renderer/global.d.ts: Renderer-side bridge contract for `window.bonzi`.
bonzi/README.md + .env.example + package.json: Current provider/environment assumptions and deps.

eliza-v2.0.0-alpha.344/packages/examples/app/electron/backend/src/runtimeManager.ts: Reference implementation for AgentRuntime boot/reuse/history/reset/send-message.
eliza-v2.0.0-alpha.344/packages/examples/app/electron/backend/src/ipc.ts: IPC handler shape for runtime-backed chat operations.
eliza-v2.0.0-alpha.344/packages/examples/app/electron/backend/src/preload.ts: Preload API exposure pattern for renderer.
eliza-v2.0.0-alpha.344/packages/examples/app/electron/backend/src/types.ts: Config + provider-mode model used by reference app.

eliza-v2.0.0-alpha.344/packages/agent/src/runtime/eliza.ts: Canonical runtime startup path and plugin wiring surface.
eliza-v2.0.0-alpha.344/packages/agent/src/runtime/plugin-lifecycle.ts: Runtime plugin ownership/lifecycle management.
eliza-v2.0.0-alpha.344/packages/agent/src/runtime/core-plugins.ts: Default core/optional plugin policy (includes `@elizaos/app-companion`).
eliza-v2.0.0-alpha.344/packages/agent/src/runtime/eliza-plugin.ts: Built-in Eliza plugin actions/providers/services composition.
eliza-v2.0.0-alpha.344/packages/agent/src/runtime/plugin-types.ts: Runtime plugin module shape + resolution helpers.
eliza-v2.0.0-alpha.344/packages/agent/src/services/app-session-gate.ts: Hosted-app session gating mechanism.
eliza-v2.0.0-alpha.344/packages/agent/src/api/misc-routes.ts: `/api/emote(s)` route bridge used by companion emote flow.

eliza-v2.0.0-alpha.344/apps/app-companion/src/plugin.ts: Companion plugin definition + session-gated wrapping.
eliza-v2.0.0-alpha.344/apps/app-companion/src/actions/emote.ts: PLAY_EMOTE action and HTTP call to local `/api/emote`.
eliza-v2.0.0-alpha.344/apps/app-companion/src/emotes/catalog.ts: Emote catalog + agent-allowed subset.
eliza-v2.0.0-alpha.344/apps/app-companion/src/components/companion/VrmStage.tsx: Companion VRM stage behavior reference.
eliza-v2.0.0-alpha.344/apps/app-companion/src/components/companion/scene-overlay-bridge.ts: Example of app-state→overlay bridge.
eliza-v2.0.0-alpha.344/apps/app-companion/src/components/companion/companion-app.ts + CompanionShell.tsx + register.ts: Companion app registration shell.

eliza-v2.0.0-alpha.344/packages/native-plugins/talkmode/src/definitions.ts: Voice/talk-mode config/state/events contract.
eliza-v2.0.0-alpha.344/packages/native-plugins/talkmode/src/web.ts: Web fallback behavior for talk mode plugin.
</selected_context>

<relationships>
- Renderer command flow today: `renderer/app.ts` → `window.bonzi.assistant.sendCommand()` (preload) → `main/ipc.ts` → `assistant.ts` provider → typed `AssistantCommandResponse` back to renderer.
- Renderer action flow today: action button in `renderer/app.ts` → `assistant:execute-action` IPC → allowlisted desktop action execution in `assistant.ts`.
- Shell metadata flow: `main/shell-state.ts` → `app:get-shell-state` IPC → renderer hydration and provider/warning display.
- Eliza reference flow: Electron IPC (`examples/.../ipc.ts`) → runtime manager (`runtimeManager.ts`) → `AgentRuntime.messageService.handleMessage` + memory persistence.
- Companion emote plugin flow in Eliza: `PLAY_EMOTE` action (`app-companion/actions/emote.ts`) → POST `/api/emote` (`agent/api/misc-routes.ts`) → websocket broadcast to client for avatar animation.
- Plugin gating pattern: `app-companion/plugin.ts` wraps raw plugin via `gatePluginSessionForHostedApp` (`agent/services/app-session-gate.ts`) so actions/providers only run while app session is active.
</relationships>

<ambiguities>
- Bonzi currently uses direct Electron IPC-only assistant responses/actions; Eliza companion emote path in references uses local HTTP `/api/*` + websocket broadcast. The migration plan should decide whether Bonzi keeps pure IPC or adopts selective local HTTP/ws bridges for plugin compatibility.
- `packages/agent/src/runtime/eliza.ts` is broad and production-heavy; for Bonzi migration planning, it is unclear whether to embed `@elizaos/core` runtime directly (example-app style) or adopt larger `@elizaos/agent` startup surfaces incrementally.
- Voice stack target is not finalized: talkmode definitions are available, but Bonzi currently has no voice pipeline or audio UI contract.
</ambiguities>

## Selection
- Files: 50 total (50 full)
- Total tokens: 115504 (Auto view)
- Token breakdown: full 115504

### Files
### Selected Files
/Users/t3rpz/projects/bonzi/
├── src/
│   ├── main/
│   │   ├── assistant.ts — 5,549 tokens (full)
│   │   ├── index.ts — 172 tokens (full)
│   │   ├── ipc.ts — 493 tokens (full)
│   │   ├── shell-state.ts — 228 tokens (full)
│   │   └── window.ts — 294 tokens (full)
│   ├── preload/
│   │   └── index.ts — 309 tokens (full)
│   ├── renderer/
│   │   ├── app.ts — 5,151 tokens (full)
│   │   ├── global.d.ts — 238 tokens (full)
│   │   ├── main.ts — 54 tokens (full)
│   │   ├── mixamo-animation-loader.ts — 1,837 tokens (full)
│   │   ├── styles.css — 2,658 tokens (full)
│   │   ├── vrm-animation-clips.ts — 2,964 tokens (full)
│   │   ├── vrm-stage.ts — 5,478 tokens (full)
│   │   └── vrma-animation-resolver.ts — 1,587 tokens (full)
│   └── shared/
│       └── contracts.ts — 430 tokens (full)
├── .env.example — 154 tokens (full)
├── README.md — 1,570 tokens (full)
├── electron.vite.config.ts — 104 tokens (full)
└── package.json — 186 tokens (full)
/Users/t3rpz/projects/eliza-v2.0.0-alpha.344/
├── apps/
│   └── app-companion/
│       ├── src/
│       │   ├── actions/
│       │   │   └── emote.ts — 830 tokens (full)
│       │   ├── components/
│       │   │   └── companion/
│       │   │       ├── CompanionShell.tsx — 208 tokens (full)
│       │   │       ├── VrmStage.tsx — 3,153 tokens (full)
│       │   │       ├── companion-app.ts — 149 tokens (full)
│       │   │       └── scene-overlay-bridge.ts — 751 tokens (full)
│       │   ├── emotes/
│       │   │   └── catalog.ts — 2,610 tokens (full)
│       │   ├── index.ts — 493 tokens (full)
│       │   ├── plugin.ts — 211 tokens (full)
│       │   ├── register.ts — 120 tokens (full)
│       │   └── ui.ts — 522 tokens (full)
│       └── package.json — 518 tokens (full)
└── packages/
    ├── agent/
    │   ├── src/
    │   │   ├── api/
    │   │   │   └── misc-routes.ts — 6,794 tokens (full)
    │   │   ├── runtime/
    │   │   │   ├── core-plugins.ts — 1,118 tokens (full)
    │   │   │   ├── eliza-plugin.ts — 2,183 tokens (full)
    │   │   │   ├── eliza.ts — 42,057 tokens (full)
    │   │   │   ├── index.ts — 136 tokens (full)
    │   │   │   ├── plugin-lifecycle.ts — 7,638 tokens (full)
    │   │   │   └── plugin-types.ts — 3,873 tokens (full)
    │   │   └── services/
    │   │       └── app-session-gate.ts — 724 tokens (full)
    │   └── package.json — 2,313 tokens (full)
    ├── examples/
    │   └── app/
    │       └── electron/
    │           ├── backend/
    │           │   ├── src/
    │           │   │   ├── ipc.ts — 437 tokens (full)
    │           │   │   ├── main.ts — 281 tokens (full)
    │           │   │   ├── preload.ts — 228 tokens (full)
    │           │   │   ├── runtimeManager.ts — 2,349 tokens (full)
    │           │   │   └── types.ts — 805 tokens (full)
    │           │   └── package.json — 315 tokens (full)
    │           └── README.md — 336 tokens (full)
    └── native-plugins/
        └── talkmode/
            ├── src/
            │   ├── definitions.ts — 1,882 tokens (full)
            │   ├── index.ts — 78 tokens (full)
            │   └── web.ts — 2,376 tokens (full)
            └── package.json — 560 tokens (full)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `bonzi-eliza-migration-2B2C3E` | **Mode**: plan

### Response
# 1. **Summary**

Refactor Bonzi with a **targeted backend replacement**, not a full app rewrite: keep the existing Electron window, preload bridge, renderer chat bubble, and Three.js/VRM stage, but replace the custom provider/fetch logic in `src/main/assistant.ts` with an embedded **Eliza `AgentRuntime`** running in the Electron main process. Use the lightweight Electron reference pattern from `packages/examples/app/electron/backend/src/runtimeManager.ts`, **not** the full `packages/agent/src/runtime/eliza.ts` startup stack, because Bonzi currently needs a constrained desktop companion, not Eliza’s full server/cloud/plugin surface. Preserve Bonzi’s current typed IPC and confirmation-gated desktop actions first; add persistence/history next; add avatar event/emote bridging after chat parity is stable.

# 2. **Current-state analysis**

## Bonzi today

### Main-process ownership
- `src/main/index.ts`
  - owns app startup and `BrowserWindow` creation lifecycle.
  - currently does **not** own assistant lifecycle directly; it delegates that to `registerIpcHandlers`.
- `src/main/ipc.ts`
  - creates the assistant service internally via `createAssistantService(...)`.
  - exposes:
    - `app:get-shell-state`
    - `assistant:send-command`
    - `assistant:execute-action`
    - window control IPCs
- `src/main/assistant.ts`
  - owns:
    - env loading
    - provider selection (`mock` vs `openai-compatible`)
    - current JSON-response enforcement
    - action proposal sanitization
    - pending-action map
    - allowlisted desktop action execution
  - this is the main subsystem being replaced.
- `src/main/shell-state.ts`
  - produces the metadata payload consumed by renderer.
  - currently hardcodes stage text and exposes current provider/action info.

### Renderer ownership
- `src/renderer/app.ts`
  - owns the UI conversation state.
  - currently treats main as a stateless assistant endpoint:
    - sends `command + history`
    - receives one `AssistantCommandResponse`
    - stores messages locally in renderer memory
  - action execution remains a second round-trip through IPC.
- `src/renderer/vrm-stage.ts`
  - owns persistent scene, model loading, idle/emote loop, pointer reaction.
  - today it has **no external action/event bridge** for runtime-driven avatar actions.
- `src/preload/index.ts` + `src/renderer/global.d.ts`
  - define the typed bridge surface `window.bonzi`.

### Shared contract shape
- `src/shared/contracts.ts`
  - canonically defines request/response payloads.
  - current protocol is **assistant-compatibility-oriented**, not runtime-oriented:
    - `AssistantCommandRequest`
    - `AssistantCommandResponse`
    - `AssistantActionExecutionRequest/Response`
    - `ShellState`

## End-to-end flow today

### Chat request
`renderer/app.ts`  
→ `window.bonzi.assistant.sendCommand()` in preload  
→ `ipcMain.handle('assistant:send-command')` in `src/main/ipc.ts`  
→ `AssistantService.sendCommand()` in `src/main/assistant.ts`  
→ direct mock logic or HTTP `fetch()`  
→ parsed/sanitized response  
→ typed IPC response back to renderer

### Desktop action execution
`renderer/app.ts` action button  
→ `window.bonzi.assistant.executeAction()`  
→ `ipcMain.handle('assistant:execute-action')`  
→ `pendingActions` lookup in `src/main/assistant.ts`  
→ `executeAllowlistedAction(...)` in main  
→ typed execution response back to renderer

### Shell state hydration
`renderer/app.ts` startup  
→ `window.bonzi.app.getShellState()`  
→ `buildShellState(...)` in `src/main/shell-state.ts`

## What should be reused

### Reuse directly
- `src/main/assistant.ts`
  - keep:
    - request validation
    - `parseProviderJson`
    - `sanitizeProposedActions`
    - `dedupeActions`
    - pending action lifecycle
    - allowlisted desktop action execution
- `src/renderer/app.ts`
  - keep current chat UI and confirmation UX initially.
- `src/preload/index.ts`, `src/renderer/global.d.ts`
  - evolve additively; do not replace with a new bridge model.
- `src/renderer/vrm-stage.ts` and animation helpers
  - keep as the stage implementation; extend only when runtime events need to drive it.

### Reuse as reference, not direct architecture
- `packages/examples/app/electron/backend/src/runtimeManager.ts`
  - use as the main pattern for `AgentRuntime` creation, reuse, persistence, and message handling.
- `packages/examples/app/electron/backend/src/ipc.ts` / `preload.ts`
  - use as API-shape reference for additive IPC methods like history/reset.
- `packages/agent/src/runtime/eliza.ts`
  - use only for env/plugin-selection ideas.
  - do **not** embed its full startup path in Bonzi.
- `packages/agent/src/runtime/core-plugins.ts` / `eliza-plugin.ts`
  - do **not** import wholesale; they enable shell/app-control/browser behaviors Bonzi explicitly does not want.
- `apps/app-companion/...`
  - use as behavior reference for emote semantics and companion responsibilities.
  - do **not** adopt its React/app-core shell or `/api/emote` transport in the initial migration.

## Hard constraints and blockers

### Security / scope constraints
- Electron main must remain the sole owner of:
  - `BrowserWindow`
  - clipboard
  - minimize/close behavior
- Bonzi must preserve its current safety model:
  - no shell execution
  - no unrestricted file/network tool surface
  - `close-window` remains confirmation-gated
- Therefore Bonzi must **not** load Eliza’s default core plugin set.

### State ownership constraints
- Current conversation history is renderer-local only.
- Eliza history will be runtime/localdb-owned.
- Pending UI action proposals remain main-process ephemeral unless explicitly persisted; this plan keeps them ephemeral.

### Transport constraints
- Current Bonzi is pure Electron IPC.
- Stock companion emote path in Eliza uses local HTTP + websocket (`/api/emote` in `misc-routes.ts`).
- Adopting that transport now would add a second, unnecessary transport stack and extra attack surface.
- Decision: **stay on IPC/push events** for Bonzi.

### Renderer capability gap
- `src/renderer/vrm-stage.ts` currently cannot receive external emote commands.
- Full `@elizaos/app-companion` emote catalog is not drop-in compatible:
  - it expects asset paths and formats Bonzi does not currently load (`.glb`, `.glb.gz`, `/api/emote` route usage).
- Initial emote bridge must therefore target Bonzi’s existing built-in clip names (`wave`, `happy-bounce`) instead of the full stock catalog.

# 3. **Design**

## A. Migration strategy and target architecture

### Chosen approach
Use a **compatibility-layer migration**:

1. Embed an Eliza `AgentRuntime` in Electron main.
2. Keep Bonzi’s existing IPC contract and renderer UI as the public surface.
3. Have `src/main/assistant.ts` become a façade over the runtime instead of over direct fetch/mock providers.
4. Keep desktop actions as Bonzi-owned UI proposals/executions initially.
5. Add runtime-owned persistence/history next.
6. Add runtime→renderer companion events after chat parity is stable.

### Why this over a broader refactor
A full switch to `@elizaos/agent` startup, API server routes, app-core overlay apps, and stock companion UI would touch nearly every Bonzi file, add HTTP/ws transport Bonzi does not need, and import unsafe default plugin behavior. Bonzi only needs:
- model-backed dialogue,
- runtime-backed memory,
- optional companion-side effects.

That is best served by the smaller `@elizaos/core` runtime-manager pattern.

### Final target ownership
- **Main process**
  - `AgentRuntime` lifecycle
  - localdb persistence
  - provider/plugin selection
  - shell-state provider injection
  - action proposal parsing/sanitization
  - action execution
  - companion event emission
- **Renderer**
  - chat bubble rendering
  - action buttons / confirmation UX
  - VRM scene rendering
  - companion event consumption

---

## B. Main-process Eliza runtime subsystem

### New component: `BonziRuntimeManager`
**File:** `src/main/eliza/runtime-manager.ts`  
**Kind:** class  
**Why:** long-lived mutable owner of runtime instance, init promise, persistent ids, provider mode, and shutdown.

### Owned state
```ts
class BonziRuntimeManager {
  private runtime: AgentRuntime | null
  private bundle: {
    runtime: AgentRuntime
    userId: UUID
    roomId: UUID
    worldId: UUID
  } | null
  private initializing: Promise<...> | null
  private currentMode: "eliza-classic" | "openai-compatible" | null
  private providerInfo: AssistantProviderInfo
  private startupWarnings: string[]
  private runtimeStatus: AssistantRuntimeStatus
  private readonly dataDir: string
  private readonly getShellState: () => ShellState
  private readonly listeners: Set<(event: AssistantEvent) => void>
}
```

### Key interfaces
```ts
constructor(options: {
  dataDir: string
  getShellState: () => ShellState
})

getProviderInfo(): AssistantProviderInfo
getStartupWarnings(): string[]
getRuntimeStatus(): AssistantRuntimeStatus

getHistory(): Promise<AssistantMessage[]>
resetConversation(): Promise<void>

sendCommand(input: {
  command: string
}): Promise<{
  reply: string
  actions: ProposedAction[]
  warnings: string[]
}>

subscribe(listener: (event: AssistantEvent) => void): () => void
dispose(): Promise<void>
```

### Behavior
- Reuse the `getOrCreateRuntime` pattern from `packages/examples/app/electron/backend/src/runtimeManager.ts`.
- Use deterministic ids:
  - `stringToUuid("bonzi-world")`
  - `stringToUuid("bonzi-room")`
  - `stringToUuid("bonzi-user")`
- Store localdb under:
  - `join(app.getPath("userData"), "eliza-localdb")`
- Recreate runtime only when effective provider mode changes or initialization fails irrecoverably.
- Do **not** use runtime plugin hot-unload/reload from `packages/agent/src/runtime/plugin-lifecycle.ts`; Bonzi has no runtime plugin admin UI, and full recreation is simpler and safer.

### Runtime creation
Reuse the example pattern:
- `new AgentRuntime({ character, plugins, actionPlanning: false, llmMode: LLMMode.SMALL })`
- `runtime.initialize()`
- `runtime.ensureConnection(...)`

### Plugin list
Use a minimal, explicit list:
- always:
  - `@elizaos/plugin-localdb`
- provider:
  - `@elizaos/plugin-openai` for `openai-compatible`
  - `@elizaos/plugin-eliza-classic` for fallback/local mode
- Bonzi-specific:
  - `createBonziContextPlugin(...)`
- later phase only:
  - `createBonziCompanionPlugin(...)`

### Explicitly not loaded
Do **not** load:
- `CORE_PLUGINS` from `packages/agent/src/runtime/core-plugins.ts`
- `createElizaPlugin()` from `packages/agent/src/runtime/eliza-plugin.ts`
- shell/app-control/browser/skills/task plugins

That preserves Bonzi’s current safety boundary.

### Runtime settings
Map existing Bonzi envs into runtime settings instead of inventing a second config model:
- `BONZI_OPENAI_API_KEY` → `OPENAI_API_KEY`
- `BONZI_OPENAI_BASE_URL` → `OPENAI_BASE_URL`
- `BONZI_OPENAI_MODEL` → both `OPENAI_SMALL_MODEL` and `OPENAI_LARGE_MODEL`
- localdb dir → `LOCALDB_DATA_DIR`

### Runtime message flow
Reuse the example `messageService.handleMessage(...)` pattern, but with one critical Bonzi-specific change:

**Persist parsed reply text, not raw JSON envelope.**

Algorithm:
1. Create user memory from the command.
2. Call `runtime.messageService.handleMessage(...)`.
3. In the assistant callback:
   - parse `content.text` with Bonzi’s existing `parseProviderJson(...)`
   - collect:
     - `reply`
     - `actions`
     - `warning`
   - persist a new assistant memory whose `content.text` is `reply`, not the raw JSON string
4. Return the parsed reply/actions to `src/main/assistant.ts`

This avoids storing raw `{"reply":"...","actions":[...]}` blobs in conversation history.

### History mapping
Use the example mapping pattern from `runtimeManager.ts`, but return Bonzi’s `AssistantMessage`:
- role:
  - runtime `entityId === userId` → `"user"`
  - otherwise `"assistant"`
- `createdAt` normalized to ISO string
- no persisted action chips; history entries restore as `actions: []`, `warnings: []`

### Error handling
Possible failures:
- provider plugin import/init failure
- missing API key for openai-compatible mode
- localdb init failure
- `messageService` unavailable
- malformed model output JSON

Propagation:
- `sendCommand` returns typed failure through `AssistantService`
- `runtimeStatus.state` becomes `"error"`
- `startupWarnings` and `shellState.assistant.runtime.lastError` surface degraded mode

Degraded behavior:
- if openai-compatible is configured but key missing, runtime manager falls back to `eliza-classic`, not the old mock provider
- if runtime init fails completely, assistant IPC remains available but returns `ok: false`

### New component: `BonziContextPlugin`
**File:** `src/main/eliza/bonzi-context-plugin.ts`  
**Kind:** factory function returning Eliza `Plugin`

### Responsibility
Expose live shell/window/avatar context to the runtime prompt composition.

### Shape
```ts
export function createBonziContextPlugin(options: {
  getShellState: () => ShellState
}): Plugin
```

### Contents
One dynamic provider is sufficient:
- provider name: `bonzi_shell_state`
- returns current shell state and allowed desktop actions in text form

Keep it provider-only; do not define native desktop execution actions here in the initial cutover.

### Why provider-only first
Bonzi already has a working, confirmation-aware action proposal and execution model. Replacing that immediately with native Eliza action execution would force renderer and safety-model changes together.

---

## C. Assistant compatibility façade

### Modified component: `src/main/assistant.ts`
Keep the file path and public factory `createAssistantService(...)`, but change its internals from provider-factory logic to runtime-bridge logic.

### Keep in this file
- `normalizeCommandRequest`
- `normalizeActionExecutionRequest`
- `parseProviderJson`
- `sanitizeProposedActions`
- `dedupeActions`
- `createPendingAction`
- `executeAllowlistedAction`
- `pendingActions` map

### Remove from this file
- `AssistantProvider` abstraction
- `createMockProvider`
- `createOpenAiCompatibleProvider`
- direct `fetch(...)` call path
- `.env`-driven provider-specific HTTP behavior

### New dependencies
`assistant.ts` should compose:
- `BonziRuntimeManager`
- allowlisted action executor
- pending action storage
- optional event subscription bridge

### Revised service interface
**Before**
```ts
export interface AssistantService {
  getProviderInfo(): AssistantProviderInfo
  getStartupWarnings(): string[]
  sendCommand(...)
  executeAction(...)
}
```

**After**
```ts
export interface AssistantService {
  getProviderInfo(): AssistantProviderInfo
  getStartupWarnings(): string[]
  getRuntimeStatus(): AssistantRuntimeStatus
  getHistory(): Promise<AssistantMessage[]>
  resetConversation(): Promise<void>
  subscribe(listener: (event: AssistantEvent) => void): () => void
  sendCommand(...)
  executeAction(...)
  dispose(): Promise<void>
}
```

### `sendCommand` flow after change
1. Normalize request.
2. Call `runtimeManager.sendCommand({ command })`.
   - ignore renderer-supplied `history` once runtime persistence is active
3. Convert returned `ProposedAction[]` into `AssistantAction[]`.
4. Store pending actions in `pendingActions`.
5. Return current `AssistantCommandResponse` shape.

### `resetConversation` semantics
- clear runtime/localdb messages for the deterministic room
- clear `pendingActions`
- do not reinitialize provider config

### Concurrency
- runtime initialization is serialized by `BonziRuntimeManager.initializing`
- command submission remains effectively single-flight because renderer already disables input while awaiting a response
- no extra command queue is required in the initial implementation

---

## D. IPC, preload, and shared contract evolution

### Modified contract file: `src/shared/contracts.ts`

### New/changed types

#### Provider kind
**Before**
```ts
type AssistantProviderKind = "mock" | "openai-compatible"
```

**After**
```ts
type AssistantProviderKind =
  | "eliza-classic"
  | "openai-compatible"
```

Environment parsing should still accept legacy `BONZI_ASSISTANT_PROVIDER=mock`, but runtime should emit `kind: "eliza-classic"`.

#### Runtime status
Add:
```ts
interface AssistantRuntimeStatus {
  backend: "eliza"
  state: "starting" | "ready" | "error"
  persistence: "localdb"
  lastError?: string
}
```

#### Shell state stage
Replace the task-specific literal with a reusable closed set:
```ts
type ShellStateStage = "runtime-starting" | "assistant-ready" | "runtime-error"
```

#### Assistant events
Add an additive event union for push-only renderer notifications:
```ts
type AssistantEvent =
  | { type: "runtime-status"; status: AssistantRuntimeStatus }
  | { type: "play-emote"; emoteId: "wave" | "happy-bounce" }
```

#### History request compatibility
Make `history` optional in `AssistantCommandRequest`:
```ts
interface AssistantCommandRequest {
  command: string
  history?: AssistantMessage[]
}
```
Main should ignore it after cutover; renderer can stop sending it in a later cleanup.

### Shell state shape
Extend, do not replace:
```ts
interface ShellState {
  stage: ShellStateStage
  platform: string
  vrmAssetPath: string
  notes: string[]
  assistant: {
    provider: AssistantProviderInfo
    availableActions: AssistantActionType[]
    warnings: string[]
    runtime: AssistantRuntimeStatus
  }
}
```

### Modified main shell state builder: `src/main/shell-state.ts`
**Before**
```ts
buildShellState(provider, warnings): ShellState
```

**After**
```ts
buildShellState(
  provider: AssistantProviderInfo,
  warnings: string[],
  runtime: AssistantRuntimeStatus
): ShellState
```

### Modified IPC registration: `src/main/ipc.ts`
**Before**
```ts
registerIpcHandlers(getCompanionWindow: () => BrowserWindow | null): void
```

**After**
```ts
registerIpcHandlers(options: {
  getCompanionWindow: () => BrowserWindow | null
  assistantService: AssistantService
}): void
```

### New IPC methods
Add:
- `assistant:get-history` → `Promise<AssistantMessage[]>`
- `assistant:reset-conversation` → `Promise<void>`

Keep existing:
- `assistant:send-command`
- `assistant:execute-action`

### Push channel
Add a send-only main→renderer channel:
- channel name: `assistant:event`

`ipc.ts` should not own subscriptions. `src/main/index.ts` should subscribe to `assistantService.subscribe(...)` and forward events to:
```ts
companionWindow?.webContents.send("assistant:event", event)
```

### Modified preload: `src/preload/index.ts`
Add:
```ts
<chatName="Bonzi Eliza Migration"/>

## 1. Summary

Refactor Bonzi by **replacing the current custom main-process assistant provider layer with an embedded Eliza `AgentRuntime`**, while **keeping the existing Electron window, preload bridge, renderer chat bubble UI, and Three.js/VRM stage intact** for the first cut. The safest path is a **targeted backend migration**, not a wholesale adoption of `@elizaos/agent`’s full startup/server/app-companion stack: Bonzi should reuse the **Electron example’s embedded runtime pattern** (`runtimeManager.ts`) and only pull in **minimal Eliza plugins** needed for chat + local persistence, then add Bonzi-specific providers/actions/events where needed. This preserves Bonzi’s current IPC contract at first, then incrementally adds persisted history, runtime status, and avatar/emote events.

---

## 2. Current-state analysis

### Bonzi today

#### Main process
- `src/main/index.ts`
  - Owns app lifecycle and the single `BrowserWindow`.
  - Calls `registerIpcHandlers()` once after `app.whenReady()`.

- `src/main/ipc.ts`
  - Creates the assistant service internally.
  - Exposes:
    - `app:get-shell-state`
    - `assistant:send-command`
    - `assistant:execute-action`
    - window control channels

- `src/main/assistant.ts`
  - Owns all assistant behavior today:
    - env loading
    - provider selection (`mock` vs `openai-compatible`)
    - prompt construction
    - JSON reply parsing
    - action proposal sanitization
    - pending action lifecycle
    - allowlisted action execution via Electron APIs
  - `sendCommand()` currently returns Bonzi-native `AssistantCommandResponse`.
  - `executeAction()` is completely outside any LLM/runtime abstraction.

- `src/main/shell-state.ts`
  - Produces `ShellState` from provider info + warnings.
  - Hardcodes:
    - stage literal
    - VRM asset path
    - notes
    - available action list

#### Preload / renderer bridge
- `src/preload/index.ts`
  - Exposes `window.bonzi`.
  - Pure invoke/send bridge, no subscriptions.

- `src/renderer/global.d.ts`
  - Declares that bridge shape.

#### Renderer
- `src/renderer/app.ts`
  - Keeps the chat UI state locally in memory.
  - Sends command history on each request.
  - Shows assistant reply + action chips.
  - Executes action chips by round-tripping to `assistant:execute-action`.
  - Has no persisted conversation source.
  - Has no event subscription path for avatar/emote/runtime events.

- `src/renderer/vrm-stage.ts`
  - Owns the persistent Three.js + VRM scene.
  - Already has:
    - stable model lifecycle
    - idle/emote animation state machine
    - built-in authored emotes (`wave`, `happy-bounce`)
    - FBX/VRMA loading for stage motions
  - Does **not** expose a public imperative API for external runtime-driven emotes.

### Eliza reference architecture relevant here

#### What should be reused
- `packages/examples/app/electron/backend/src/runtimeManager.ts`
  - Correct reference for:
    - long-lived `AgentRuntime` ownership in Electron main
    - initialization serialization
    - plugin selection
    - persistent room/user/world IDs
    - memory-backed history
    - `messageService.handleMessage()`

- `packages/examples/app/electron/backend/src/ipc.ts` and `src/preload.ts`
  - Correct reference for keeping IPC thin and main-owned.

#### What should **not** be adopted directly yet
- `packages/agent/src/runtime/eliza.ts`
  - Too broad for Bonzi’s current scope:
    - config system
    - cloud/server boot
    - hooks
    - sandbox
    - core plugin defaults
    - API server
  - Importing this whole startup surface would over-expand Bonzi’s behavior and risk.

- `packages/agent/src/runtime/core-plugins.ts`
  - Includes plugins Bonzi explicitly does **not** want to auto-enable, such as shell/app-control/browser-related capabilities.

- `packages/agent/src/runtime/eliza-plugin.ts`
  - Bundles many actions/providers/services outside Bonzi’s current safety model.

- `apps/app-companion` UI components
  - They depend on `@elizaos/app-core` and would force a renderer rewrite Bonzi is explicitly trying to avoid initially.

### Key architecture constraints

- **Electron main owns all privileged effects**:
  - window minimize/close/position
  - clipboard
  - any future native voice bridge
- **Renderer must stay unprivileged**:
  - preload remains the typed boundary
  - no new direct Node access
- **Current Bonzi action safety model must remain**:
  - no shell/plugin sprawl
  - no `plugin-shell`
  - no adopting Eliza core plugin defaults wholesale
- **Current renderer UX should survive the backend swap**:
  - same command form
  - same bubble UI
  - same action chip flow
- **No existing persistence schema must be migrated**
  - Bonzi has no stored assistant history today
  - Eliza local persistence can be additive

### End-to-end call chain today vs target

#### Today
`renderer/app.ts`
→ `window.bonzi.assistant.sendCommand()`
→ `preload/index.ts`
→ `ipc.ts`
→ `assistant.ts`
→ provider (`mock` / `fetch`)
→ `AssistantCommandResponse`
→ renderer

#### Target
`renderer/app.ts`
→ `window.bonzi.assistant.sendCommand()`
→ `preload/index.ts`
→ `ipc.ts`
→ `assistant.ts` compatibility façade
→ `ElizaRuntimeManager.sendMessage()`
→ `AgentRuntime.messageService.handleMessage()`
→ minimal Eliza plugin set + Bonzi context provider
→ raw assistant text
→ Bonzi JSON parse/sanitize layer
→ `AssistantCommandResponse`
→ renderer

That keeps the renderer stable while changing the intelligence/persistence layer underneath.

---

## 3. Design

### A. Migration strategy and target architecture

#### Decision
Use a **targeted backend replacement**:
- embed `AgentRuntime` directly in Bonzi main
- preserve Bonzi’s IPC + renderer contract initially
- add runtime-backed persistence and events incrementally
- do **not** adopt `@elizaos/agent` full startup or local HTTP/WebSocket server in phase 1

#### Why this is the right boundary
- Bonzi already has a working Electron shell and renderer.
- The biggest replaceable seam is `src/main/assistant.ts`.
- The Electron example already proves the runtime-in-main pattern Bonzi needs.
- Full `@elizaos/agent` startup would add a second architecture (server/config/plugin platform) before Bonzi needs it.

#### Final near-term architecture
- `src/main/assistant.ts`
  - Bonzi compatibility façade
  - keeps:
    - request normalization
    - action proposal parsing
    - pending confirmation state
    - Electron action execution
  - delegates LLM conversation/history to runtime manager

- `src/main/eliza/runtime-manager.ts`
  - sole owner of `AgentRuntime`
  - localdb-backed history
  - provider/plugin configuration
  - message dispatch
  - runtime lifecycle

- `src/main/eliza/config.ts`
  - maps Bonzi env vars to runtime provider mode/settings

- `src/main/eliza/bonzi-context-plugin.ts`
  - injects live shell/desktop/avatar state into Eliza prompt context

- `src/main/eliza/bonzi-companion-plugin.ts` (later phase)
  - emits Bonzi-native avatar events like built-in emotes

- `src/main/ipc.ts`
  - transport only
  - no runtime creation logic

- `src/preload/index.ts` / `src/renderer/global.d.ts`
  - additive bridge evolution:
    - history
    - reset
    - event subscription

- `src/renderer/app.ts`
  - same UI
  - adds history hydration and event consumption

---

### B. Main-process Eliza runtime subsystem

#### New component: `ElizaRuntimeManager`
**File:** `src/main/eliza/runtime-manager.ts`  
**Kind:** class  
**Why class:** it owns long-lived mutable process state, initialization serialization, runtime teardown, and persistence identity.

#### Owned state
Use a shape equivalent to:

```ts
type RuntimeBundle = {
  runtime: AgentRuntime
  userId: UUID
  roomId: UUID
  worldId: UUID
}

class ElizaRuntimeManager {
  private bundle: RuntimeBundle | null
  private initializing: Promise<RuntimeBundle> | null
  private effectiveMode: 'eliza-classic' | 'openai-compatible' | null
  private providerInfo: AssistantProviderInfo
  private startupWarnings: string[]
  private runtimeStatus: AssistantRuntimeStatus
  private listeners: Set<(event: AssistantEvent) => void>
}
```

#### Responsibilities
- Resolve provider mode/settings from Bonzi env
- Create/recreate `AgentRuntime`
- Configure plugin list
- Persist and fetch conversation history
- Send messages through `messageService`
- Emit Bonzi-side runtime events later (emote, status)

#### Public API
Add methods with these semantics:

```ts
getProviderInfo(): AssistantProviderInfo
getStartupWarnings(): string[]
getRuntimeStatus(): AssistantRuntimeStatus
getHistory(): Promise<AssistantMessage[]>
resetConversation(): Promise<void>
sendMessage(command: string): Promise<{
  replyText: string
  proposedActions: ProposedAction[]
  warnings: string[]
}>
subscribe(listener: (event: AssistantEvent) => void): () => void
dispose(): Promise<void>
```

#### Runtime creation flow
Reuse the example app pattern from `packages/examples/app/electron/backend/src/runtimeManager.ts`:

1. Resolve effective mode from Bonzi env
2. If existing runtime mode matches, reuse it
3. Else:
   - stop old runtime
   - create new `AgentRuntime`
   - set provider/plugin settings
   - initialize runtime
   - call `ensureConnection()` with deterministic IDs
   - cache bundle

#### Deterministic identity
Use fixed UUID inputs via `stringToUuid()`:
- room: `"bonzi-room"`
- user: `"bonzi-user"`
- world: `"bonzi-world"`

This keeps a single local desktop conversation persistent across app restarts.

#### Persistence location
Use Electron `app.getPath("userData")`, not `process.cwd()`.

Target dir:
- `${app.getPath("userData")}/eliza-localdb`

This is consistent with the Electron example and safe for packaged builds.

#### Plugin list
Do **not** use `CORE_PLUGINS` from `packages/agent/src/runtime/core-plugins.ts`.

Use a minimal, explicit list:
- always:
  - `@elizaos/plugin-localdb`
  - `createBonziContextPlugin(...)`
- provider-specific:
  - `@elizaos/plugin-openai` for `openai-compatible`
  - `@elizaos/plugin-eliza-classic` for fallback/local-safe mode
- later:
  - `createBonziCompanionPlugin(...)`

That preserves Bonzi’s current safety boundary.

#### Character/system prompt
Move the current JSON-only contract from `src/main/assistant.ts` into a dedicated character builder.

**New file:** `src/main/eliza/bonzi-character.ts`

Build the character once per runtime mode with:
- `name: "Bonzi"`
- `system`: current JSON envelope rules, action allowlist, confirmation rule
- optional override from `BONZI_OPENAI_SYSTEM_PROMPT`

Do **not** append live shell state into the system string each turn.  
Instead, expose shell state through a provider plugin.

#### New component: `createBonziContextPlugin`
**File:** `src/main/eliza/bonzi-context-plugin.ts`  
**Kind:** plugin factory function

It should close over:
- `getShellState: () => ShellState`

Provide one provider, e.g. `bonzi_shell_state`, that returns structured text summarizing:
- platform
- VRM asset path
- runtime stage/status
- allowed desktop actions
- current warnings

This reuses Eliza’s normal provider composition instead of manually stuffing shell state into each request body.

---

### C. Assistant compatibility façade

#### Modified component: `createAssistantService`
**File:** `src/main/assistant.ts`

This file should stop owning provider implementations. It should become:
- request validator
- response parser
- pending action store
- Electron action executor
- façade over `ElizaRuntimeManager`

#### Keep and reuse
Preserve these existing helpers with minimal changes:
- `normalizeCommandRequest`
- `normalizeActionExecutionRequest`
- `parseProviderJson`
- `sanitizeProposedActions`
- `dedupeActions`
- `createPendingAction`
- `executeAllowlistedAction`

These are Bonzi-specific compatibility logic and should not be duplicated inside the runtime manager.

#### Remove from this file
Delete or move out:
- `selectProvider`
- `createMockProvider`
- `createOpenAiCompatibleProvider`
- direct `fetch("/chat/completions")` logic
- `AssistantProvider` abstraction

#### New dependency
`createAssistantService()` should create and own one `ElizaRuntimeManager`.

#### Send flow after refactor
`sendCommand()` should do exactly:

1. normalize request
2. await `runtimeManager.sendMessage(normalized.command)`
3. for each proposed action:
   - create Bonzi `AssistantAction`
   - store in `pendingActions`
4. return Bonzi `AssistantCommandResponse`

#### Important persistence transformation
Because the Eliza runtime will generate a JSON envelope string, `runtimeManager.sendMessage()` must:
- parse that JSON before persisting assistant memory
- persist only `replyText`, not the raw JSON envelope

Otherwise history will rehydrate as raw JSON in the renderer.

That means the callback passed to `runtime.messageService.handleMessage()` must:
- inspect `content.text`
- run `parseProviderJson()`
- persist `parsed.reply`
- capture `parsed.actions` and `parsed.warning` for the IPC response

#### Action execution remains main-owned
`executeAction()` should remain outside Eliza for now.
Reasons:
- current renderer depends on explicit confirmation chips
- minimize/close/clipboard are Electron-side concerns
- this keeps Bonzi’s safety model stable

#### Added service methods
Extend `AssistantService` to include:
- `getRuntimeStatus()`
- `getHistory()`
- `resetConversation()`
- `subscribe()`
- `dispose()`

Example shape:

```ts
export interface AssistantService {
  getProviderInfo(): AssistantProviderInfo
  getStartupWarnings(): string[]
  getRuntimeStatus(): AssistantRuntimeStatus
  getHistory(): Promise<AssistantMessage[]>
  resetConversation(): Promise<void>
  sendCommand(request: AssistantCommandRequest): Promise<AssistantCommandResponse>
  executeAction(request: AssistantActionExecutionRequest): Promise<AssistantActionExecutionResponse>
  subscribe(listener: (event: AssistantEvent) => void): () => void
  dispose(): Promise<void>
}
```

#### Reset semantics
When `resetConversation()` is called:
- delete runtime memories for Bonzi’s room
- clear `pendingActions`
- do not rebuild runtime unless necessary

---

### D. IPC, preload, and contract evolution

#### Modified contract file
**File:** `src/shared/contracts.ts`

#### Keep stable initially
Do not rename existing channels or break current request/response shapes immediately.

#### Additive contract changes

##### 1. Provider/runtime metadata
Expand provider/runtime typing:

```ts
export type AssistantProviderKind =
  | 'openai-compatible'
  | 'eliza-classic'

export interface AssistantRuntimeStatus {
  backend: 'eliza'
  state: 'starting' | 'ready' | 'error'
  persistence: 'localdb'
  lastError?: string
}
```

`mock` should remain accepted by env parsing only as a legacy input alias, but Bonzi should emit `eliza-classic` as the actual provider kind after migration.

##### 2. Shell state
Broaden `ShellState.stage` from the task-specific literal to a reusable union, e.g.:

```ts
export type ShellStage =
  | 'runtime-starting'
  | 'assistant-ready'
  | 'runtime-error'
```

Add runtime metadata under `assistant`:

```ts
assistant: {
  provider: AssistantProviderInfo
  availableActions: AssistantActionType[]
  warnings: string[]
  runtime: AssistantRuntimeStatus
}
```

##### 3. History/reset API
Add:
```ts
export interface AssistantHistoryResponse {
  messages: AssistantMessage[]
}
```

Or simpler: return `AssistantMessage[]` directly from IPC. Since the bridge is internal, returning the array directly is fine and simpler.

##### 4. Event API for later phases
Add an event union now so later IPC doesn’t invent ad hoc payloads:

```ts
export type AssistantEvent =
  | { type: 'runtime-status'; status: AssistantRuntimeStatus }
  | { type: 'play-emote'; emoteId: 'wave' | 'happy-bounce' }
```

Keep it small until phase 3.

##### 5. Request compatibility
Make `AssistantCommandRequest.history` optional:
```ts
history?: AssistantMessage[]
```

Bonzi main should stop depending on renderer-supplied history once runtime persistence is active.

#### Modified IPC transport
**File:** `src/main/ipc.ts`

##### Signature change
Before:
```ts
registerIpcHandlers(getCompanionWindow)
```

After:
```ts
registerIpcHandlers({
  getCompanionWindow,
  assistantService
})
```

Reason: `index.ts` should own runtime lifecycle and be able to dispose it on quit.

##### Existing handlers retained
Keep:
- `app:get-shell-state`
- `assistant:send-command`
- `assistant:execute-action`

##### New handlers
Add:
- `assistant:get-history`
- `assistant:reset-conversation`

##### Push events
Use `BrowserWindow.webContents.send("assistant:event", event)` for runtime events.
Do not add WebSocket/HTTP for this phase.

#### Modified preload bridge
**File:** `src/preload/index.ts`

Add:
- `assistant.getHistory(): Promise<AssistantMessage[]>`
- `assistant.resetConversation(): Promise<void>`
- `assistant.onEvent(listener): () => void`

`onEvent` should be implemented with `ipcRenderer.on("assistant:event", ...)` and return an unsubscribe closure.

#### Modified renderer typings
**File:** `src/renderer/global.d.ts`

Mirror the preload changes exactly.

---

### E. Shell state builder

#### Modified component
**File:** `src/main/shell-state.ts`

#### Signature change
Before:
```ts
buildShellState(provider, warnings)
```

After:
```ts
buildShellState({
  provider,
  warnings,
  runtimeStatus
})
```

#### Behavioral change
- stage should reflect runtime lifecycle
- notes should explain:
  - Eliza runtime is embedded in main
  - history is persisted locally
  - desktop actions remain allowlisted and confirmation-gated

#### Ownership
`ipc.ts` and any main bootstrap caller become the only creators.

---

### F. Renderer preservation + history hydration

#### Modified renderer entry point
**File:** `src/renderer/app.ts`

#### Initial goal
Keep the current UI and interaction model.

#### Required changes

##### 1. Startup hydration
On boot, fetch:
- `app.getShellState()`
- `assistant.getHistory()`

History should be loaded before the first empty-state render stabilizes.

Hydration mapping:
- each persisted `AssistantMessage` becomes a `ConversationEntry`
- `actions: []`
- `warnings: []`

Pending action chips are intentionally not persisted.

##### 2. Request path
Keep the submit flow visually identical.
Main difference:
- renderer can continue sending `history` during phase 1
- main ignores it once runtime persistence is authoritative

After phase 2 cleanup, renderer should stop building/sending `conversationHistory()`.

##### 3. Reset support
No UI control is required immediately, but wire the bridge method so a later button/menu item doesn’t need another preload contract change.

##### 4. Runtime events
Subscribe to `assistant.onEvent(...)` in phase 3.
For phase 1/2, only runtime-status events may be used.

#### Out-of-order and dropped event behavior
- startup/runtime-status events are queryable via `getShellState()`, so no buffering needed
- transient emote events in phase 3 should be dropped if no renderer listener exists yet; they are cosmetic

---

### G. Avatar/emote bridge (phase 3)

#### Why Bonzi should not use stock app-companion emote flow yet
Do **not** adopt:
- `apps/app-companion/src/plugin.ts`
- `actions/emote.ts`
- `/api/emote` from `packages/agent/src/api/misc-routes.ts`

for the first Bonzi migration, because:
- stock action expects a local HTTP server
- stock catalog references asset formats/path conventions Bonzi does not currently load (`.glb`, `.glb.gz`)
- Bonzi already has built-in authored clips and no event transport yet

#### New component: `createBonziCompanionPlugin`
**File:** `src/main/eliza/bonzi-companion-plugin.ts`

**Kind:** plugin factory function

#### Scope
Add a single safe native Eliza action:
- `PLAY_EMOTE`

But constrain it to Bonzi-supported built-ins:
- `wave`
- `happy-bounce`

Parameter enum must match actual clip names already present in `src/renderer/vrm-animation-clips.ts`.

#### Handler contract
The action handler should:
- validate companion window/session availability
- emit `AssistantEvent { type: 'play-emote', emoteId }`
- return success without touching Electron window state directly

This lets Eliza trigger avatar behavior without introducing HTTP.

#### Modified stage controller
**File:** `src/renderer/vrm-stage.ts`

Extend `VrmStageController`:

```ts
export interface VrmStageController {
  dispose(): void
  load(assetPath: string): Promise<void>
  playBuiltInEmote(emoteId: 'wave' | 'happy-bounce'): boolean
}
```

#### Internal state change
Reuse existing `currentAnimationState.emotes`.
Implementation behavior should be:
- find the named emote clip by `name`
- if not found, return `false`
- if found:
  - interrupt current random emote/return transition
  - start requested clip immediately
  - after clip ends, return to idle and resume scheduled random loop

#### Edge cases
- duplicate request for currently playing emote: restart from time 0
- request before model load: return `false`; renderer may ignore
- request after load failure: return `false`
- request while another one-shot is active: latest request wins

#### Renderer event wiring
**File:** `src/renderer/app.ts`

On `play-emote` event:
- call `vrmStage.playBuiltInEmote(emoteId)`

If the stage is not ready yet:
- keep only the latest pending emote in memory
- replay it after successful `load()`

This avoids building a general event queue for a cosmetic feature.

---

### H. Dependency and runtime setup

#### Modified dependency manifest
**File:** `package.json`

Add runtime deps:
- `@elizaos/core`
- `@elizaos/plugin-localdb`
- `@elizaos/plugin-openai`
- `@elizaos/plugin-eliza-classic`

Add `uuid` only if implementation chooses the example’s UUID generation path instead of `crypto.randomUUID()` + `stringToUuid()`.

#### Version policy
Pin exact published versions, not broad workspace-style aliases.

#### Important validation
Before landing runtime code, confirm the chosen `@elizaos/*` packages install as compiled JS in npm.
If they resolve to TS source or ESM that `externalizeDepsPlugin()` cannot run directly, modify:

**File:** `electron.vite.config.ts`

so main/preload do **not** externalize those packages and let Vite transpile them.

That change is only needed if package publication format requires it.

#### Modified env template
**File:** `.env.example`

Keep current Bonzi env names for user-facing compatibility:
- `BONZI_ASSISTANT_PROVIDER`
- `BONZI_OPENAI_BASE_URL`
- `BONZI_OPENAI_MODEL`
- `BONZI_OPENAI_API_KEY`
- `BONZI_OPENAI_SYSTEM_PROMPT`

Behavior changes:
- `mock` becomes a legacy alias meaning “use Eliza Classic fallback”
- `openai-compatible` maps to Eliza OpenAI plugin settings

Do **not** expose raw `OPENAI_*` envs directly in Bonzi’s user docs; keep Bonzi’s names as the stable outer API.

#### README changes
**File:** `README.md`

Update:
- architecture description: embedded Eliza runtime in Electron main
- local history persistence location/behavior
- provider mapping (`mock` → Eliza Classic fallback)
- explicitly state Bonzi still keeps its allowlisted desktop action execution layer
- note that Bonzi is **not** running the full Eliza API server in this phase

---

### I. Concurrency, lifecycle, and failure handling

#### Runtime initialization
- main-thread async only
- serialize via one `initializing` promise in `ElizaRuntimeManager`
- concurrent `sendMessage()`/`getHistory()` during startup must await the same promise

#### Runtime reuse
- recreate only when effective provider mode/settings change
- otherwise reuse existing runtime and room identity

#### Shutdown
Best-effort on app quit:
- `src/main/index.ts` should call `assistantService.dispose()`
- `dispose()` should:
  - clear listeners
  - clear pending actions
  - stop runtime if initialized

Electron quit hooks are not reliably awaitable, so this is best-effort cleanup, not a transaction boundary.

#### Failure mode
If runtime init fails:
- `getShellState()` should expose `assistant.runtime.state = "error"`
- `assistant:send-command` should return `ok: false` with the initialization error
- renderer behavior remains the same as today: append a system/error message

#### Pending actions lifecycle
Pending Bonzi action proposals remain in-memory only.
They are:
- created on each successful assistant turn
- invalid after app restart
- cleared on conversation reset
- unaffected by persisted history replay

This is intentional; only conversation text is persisted.

---

### J. Deferred surfaces

These should be explicitly deferred until after chat migration stabilizes:

#### 1. Full `@elizaos/agent` boot path
- `packages/agent/src/runtime/eliza.ts`
- dynamic plugin lifecycle
- API server
- cloud/onboarding stack

#### 2. Stock `@elizaos/app-companion` UI
- `CompanionShell.tsx`
- `VrmStage.tsx`
- app-core overlay registration

#### 3. Talk mode / voice
Use `packages/native-plugins/talkmode/src/definitions.ts` only as the future contract reference.
Do not add voice IPC until text chat + history + emote bridge are stable.

---

## 4. File-by-file impact

### `/Users/t3rpz/projects/bonzi/package.json`
- **What changes**
  - Add minimal Eliza runtime/plugin dependencies.
  - Possibly add `uuid` if needed.
- **Why**
  - Enables embedded `AgentRuntime` + local persistence + provider plugin.
- **Dependencies**
  - Must land before new runtime files compile.

### `/Users/t3rpz/projects/bonzi/.env.example`
- **What changes**
  - Update comments to reflect Eliza-backed behavior.
  - Document `mock` as legacy alias to Eliza Classic fallback.
- **Why**
  - Preserve current Bonzi env surface while changing backend internals.
- **Dependencies**
  - Follows `src/main/eliza/config.ts` design.

### `/Users/t3rpz/projects/bonzi/README.md`
- **What changes**
  - Replace “custom assistant provider” wording with embedded Eliza runtime architecture.
  - Document persistence and provider mapping.
  - Keep current safety model description.
- **Why**
  - User-facing runtime behavior changes materially.
- **Dependencies**
  - Update after runtime manager and provider mapping are implemented.

### `/Users/t3rpz/projects/bonzi/electron.vite.config.ts`
- **What changes**
  - Only if required: stop externalizing `@elizaos/*` packages and let Vite transpile them.
- **Why**
  - Some Eliza packages may not execute correctly when treated as raw externals.
- **Dependencies**
  - Depends on dependency-install validation outcome.

### `/Users/t3rpz/projects/bonzi/src/main/index.ts`
- **What changes**
  - Create `assistantService` directly here.
  - Pass it into `registerIpcHandlers(...)`.
  - Subscribe to assistant events and forward them to the current window via `webContents.send("assistant:event", ...)`.
  - Dispose service on quit.
- **Why**
  - `index.ts` is the true owner of process lifecycle and window event forwarding.
- **Dependencies**
  - Requires `AssistantService.subscribe()` and `dispose()`.
  - Requires `ipc.ts` signature change.

### `/Users/t3rpz/projects/bonzi/src/main/ipc.ts`
- **What changes**
  - Stop constructing the assistant service internally.
  - Accept injected `assistantService`.
  - Add handlers for `assistant:get-history` and `assistant:reset-conversation`.
  - Continue serving `app:get-shell-state` from assistant service runtime snapshot.
- **Why**
  - Keeps IPC transport-only and lets `index.ts` own runtime lifecycle.
- **Dependencies**
  - Depends on `AssistantService` expansion and `buildShellState()` signature change.

### `/Users/t3rpz/projects/bonzi/src/main/assistant.ts`
- **What changes**
  - Remove direct provider abstraction/fetch logic.
  - Instantiate and delegate to `ElizaRuntimeManager`.
  - Preserve Bonzi request normalization, JSON parsing, action proposal lifecycle, and Electron action execution.
  - Add `getRuntimeStatus()`, `getHistory()`, `resetConversation()`, `subscribe()`, `dispose()`.
- **Why**
  - This is the main compatibility seam; renderer can remain stable while the backend changes.
- **Dependencies**
  - Depends on new `src/main/eliza/*` files.

### `/Users/t3rpz/projects/bonzi/src/main/shell-state.ts`
- **What changes**
  - Broaden `ShellState.stage`.
  - Accept runtime status in `buildShellState(...)`.
  - Update notes to describe embedded Eliza runtime and persistence.
- **Why**
  - Shell state becomes the renderer’s source of truth for runtime health.
- **Dependencies**
  - Depends on `contracts.ts` changes.

### `/Users/t3rpz/projects/bonzi/src/main/eliza/config.ts` **(new)**
- **What changes**
  - Parse Bonzi env vars.
  - Resolve effective provider mode.
  - Produce provider info label + startup warnings + provider settings.
- **Why**
  - Centralizes Bonzi-to-Eliza config mapping and preserves current env API.
- **Dependencies**
  - Used by `runtime-manager.ts` and `assistant.ts`.

### `/Users/t3rpz/projects/bonzi/src/main/eliza/bonzi-character.ts` **(new)**
- **What changes**
  - Build the Bonzi `Character` / system prompt used by `AgentRuntime`.
- **Why**
  - Separates Bonzi’s JSON envelope rules from transport/runtime ownership.
- **Dependencies**
  - Used by `runtime-manager.ts`.

### `/Users/t3rpz/projects/bonzi/src/main/eliza/bonzi-context-plugin.ts` **(new)**
- **What changes**
  - Add a provider exposing current shell/desktop/avatar context to the runtime.
- **Why**
  - Replaces today’s manual shell state prompt stuffing with a proper Eliza provider.
- **Dependencies**
  - Used by `runtime-manager.ts`.
  - Depends on `ShellState`.

### `/Users/t3rpz/projects/bonzi/src/main/eliza/runtime-manager.ts` **(new)**
- **What changes**
  - Own all `AgentRuntime` lifecycle, persistence, message dispatch, history mapping, and reset behavior.
- **Why**
  - Encapsulates the Eliza-specific runtime state and keeps `assistant.ts` Bonzi-specific.
- **Dependencies**
  - Depends on `config.ts`, `bonzi-character.ts`, `bonzi-context-plugin.ts`, and package deps.

### `/Users/t3rpz/projects/bonzi/src/main/eliza/bonzi-companion-plugin.ts` **(new, phase 3)**
- **What changes**
  - Add native `PLAY_EMOTE` action limited to Bonzi-supported built-ins.
  - Emit assistant events instead of making HTTP calls.
- **Why**
  - Gives Eliza a path to drive Bonzi’s avatar without adopting `app-companion`’s HTTP/server model.
- **Dependencies**
  - Depends on event contract and renderer emote support.

### `/Users/t3rpz/projects/bonzi/src/preload/index.ts`
- **What changes**
  - Add `assistant.getHistory()`
  - Add `assistant.resetConversation()`
  - Add `assistant.onEvent(listener)`
- **Why**
  - Renderer needs persisted history and push events without direct IPC usage.
- **Dependencies**
  - Depends on `ipc.ts` handlers and event channel.

### `/Users/t3rpz/projects/bonzi/src/shared/contracts.ts`
- **What changes**
  - Add `AssistantRuntimeStatus`
  - Add `AssistantEvent`
  - Broaden `AssistantProviderKind`
  - Make `AssistantCommandRequest.history` optional
  - Broaden `ShellState.stage`
  - Add runtime metadata under `ShellState.assistant`
- **Why**
  - This is the canonical compatibility boundary between main/preload/renderer.
- **Dependencies**
  - Must land before preload/renderer/main type updates.

### `/Users/t3rpz/projects/bonzi/src/renderer/global.d.ts`
- **What changes**
  - Mirror preload API additions exactly.
- **Why**
  - Keeps renderer type safety intact.
- **Dependencies**
  - Depends on `contracts.ts` and preload changes.

### `/Users/t3rpz/projects/bonzi/src/renderer/app.ts`
- **What changes**
  - Hydrate persisted history on startup.
  - Optionally stop depending on outgoing history once phase 2 cleanup lands.
  - Subscribe to `assistant.onEvent(...)` in phase 3.
  - Replay pending emote after stage load if needed.
- **Why**
  - Preserves current UI while benefiting from runtime-backed memory and events.
- **Dependencies**
  - Depends on preload/global contracts.
  - Phase 3 depends on `vrm-stage.ts` emote API.

### `/Users/t3rpz/projects/bonzi/src/renderer/vrm-stage.ts`
- **What changes**
  - Extend `VrmStageController` with a public built-in emote trigger method.
  - Reuse existing named emote actions (`wave`, `happy-bounce`) instead of adding new loaders.
- **Why**
  - Bonzi needs a narrow imperative avatar API for runtime-driven events.
- **Dependencies**
  - Depends on phase 3 event bridge.
  - Reuses existing animation state.

---

## 5. Risks and migration

### Dependency publication risk
The biggest unknown is whether the exact `@elizaos/*` packages Bonzi needs are installable as compiled npm packages under Electron/Vite without Bun/workspace assumptions.

**Validation step:** before refactoring main code, perform a dependency spike:
- install chosen package versions
- import them from a temporary `src/main/eliza/runtime-manager.ts`
- run `npm run typecheck`
- start Electron dev build

If import format is incompatible with current `externalizeDepsPlugin()`, adjust `electron.vite.config.ts` in the same step.

### Behavior expansion risk
Using `@elizaos/agent` core plugin defaults would silently widen Bonzi’s capabilities.

**Mitigation:** do not use `core-plugins.ts`, `eliza-plugin.ts`, or `eliza.ts` startup wholesale. Keep the plugin list explicit and minimal.

### History format risk
If raw JSON envelopes are persisted instead of parsed reply text, startup hydration will regress the renderer.

**Mitigation:** parse runtime output before persisting assistant memory.

### Rollback
Rollback is low-risk:
- Bonzi currently has no persisted assistant data to migrate
- new localdb files are additive
- if Eliza backend must be reverted, stale localdb files can remain unused

---

## 6. Implementation order

1. **Dependency spike and build validation**
   - Update `package.json`
   - validate `@elizaos/*` import/runtime format
   - only modify `electron.vite.config.ts` if required  
   **Test:** `npm run typecheck`, app boots

2. **Introduce shared runtime contracts**
   - update `src/shared/contracts.ts`
   - update `src/preload/index.ts`
   - update `src/renderer/global.d.ts`  
   Keep changes additive only.  
   **Test:** typecheck passes with no behavior change yet

3. **Add Eliza runtime foundation**
   - create `src/main/eliza/config.ts`
   - create `src/main/eliza/bonzi-character.ts`
   - create `src/main/eliza/bonzi-context-plugin.ts`
   - create `src/main/eliza/runtime-manager.ts`  
   **Test:** isolated compile, no IPC wiring yet

4. **Refactor assistant service to use runtime manager**
   - modify `src/main/assistant.ts`
   - remove direct provider fetch logic
   - keep action proposal/execution compatibility intact  
   **Test:** send command returns Bonzi-shaped response via unit/manual smoke

5. **Move assistant service ownership to app bootstrap**
   - modify `src/main/index.ts`
   - modify `src/main/ipc.ts`
   - inject `assistantService` instead of constructing it in IPC
   - wire best-effort dispose on quit  
   **Test:** app boots, commands work, provider label shows Eliza-backed mode

6. **Update shell state to expose runtime metadata**
   - modify `src/main/shell-state.ts`
   - update `app:get-shell-state` callers  
   **Test:** renderer still loads, shell state contains runtime info

7. **Hydrate persisted history in renderer**
   - modify `src/renderer/app.ts`
   - add startup `assistant.getHistory()` load
   - add `assistant.resetConversation()` plumbing if exposing later  
   **Test:** send a message, restart app, prior messages reappear

8. **Clean up renderer’s dependency on outbound history**
   - make `AssistantCommandRequest.history` effectively ignored in main
   - stop using renderer history as authoritative source
   - optionally stop sending it from renderer once stable  
   **Test:** multiple messages still preserve context after restart

9. **Add event bridge for avatar behavior**
   - add `AssistantEvent` push plumbing in `index.ts`, preload, renderer
   - create `src/main/eliza/bonzi-companion-plugin.ts`
   - extend `src/renderer/vrm-stage.ts` with `playBuiltInEmote()`  
   **Atomic step:** plugin + event contract + renderer handler + stage API must land together  
   **Test:** runtime-triggered `PLAY_EMOTE` visibly plays `wave`

10. **Documentation and hardening**
    - update `.env.example`
    - update `README.md`
    - remove any dead provider code left in `assistant.ts`  
    **Test:** final typecheck, final manual smoke: boot, chat, restart, action chips, emote event


> 💡 Continue this plan conversation with ask_oracle(chat_id: "bonzi-eliza-migration-2B2C3E", new_chat: false)