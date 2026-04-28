# Investigation: Multi-Step Task Execution

## Summary
Bonzi currently implements a single runtime turn that proposes action cards, then executes those external cards later and records observations as passive memory. It does not yet implement the missing plan → act → observe → continue loop needed for elizaOS-like multi-step task execution.

## Symptoms
- Multi-step tasks are not reliably decomposed into ordered steps.
- Bonzi may execute too quickly without wait times between action/observation cycles.
- Bonzi may perform one task/action and then require the user to explicitly ask for the next task again.
- Desired behavior: break tasks into steps and execute across turns/action cycles like elizaOS-style workflows.

## Background / Prior Research

### ElizaOS multi-step/action-planning docs (official docs, checked 2026-04-27)
- Official action-planning guide states the target behavior directly: complex tasks require multiple actions in sequence, with results from one action feeding the next; ElizaOS represents this as an `ActionPlan` with `thought`, `totalSteps`, `currentStep`, and `steps[]` containing `status`, `result`, and `error`. Source: https://docs.elizaos.ai/guides/action-planning lines 100-129.
- Action handlers are expected to read `state.data.actionResults` and `state.data.actionPlan`, so subsequent actions can inspect prior results and plan progress. Source: https://docs.elizaos.ai/guides/action-planning lines 132-188.
- ElizaOS retrieves all action results after message processing with `runtime.getActionResults(messageId)`; docs recommend returning structured `data`, idempotency, prerequisite checks, and graceful failure. Source: https://docs.elizaos.ai/guides/action-planning lines 223-263.
- Official core runtime docs describe a processing pipeline of message receipt, memory storage, state composition, action selection, action execution, evaluation, and response generation; its simplified `processActions` loops selected actions sequentially and runs evaluators afterward. Source: https://docs.elizaos.ai/runtime/core lines 344-398 and 544-558.
- Runtime docs also describe run tracking and `getActionResults(messageId)` for action chaining. Source: https://docs.elizaos.ai/runtime/core lines 652-698.
- Background task docs describe chained background tasks where one worker creates the next task with the prior result in metadata, plus progress updates for long-running workers. Source: https://docs.elizaos.ai/guides/background-tasks lines 403-448.

### Bonzi workflow/action-runner git archaeology
- `d12c845` (2026-04-24 12:05): introduced monolithic `src/main/eliza/runtime-manager.ts`; origin of runtime/action proposal extraction.
- `670095a` (2026-04-25 13:20): introduced `src/main/eliza/workflow-manager.ts` and `src/main/eliza/workflow-action-instrumentation.ts`, creating Bonzi workflow runs, step tracking, approval flow, persistence, and plugin action instrumentation.
- `fb7dc9b` (2026-04-25 14:14): added approval autonomy toggle and auto-approve behavior for pending/new approval requests.
- `d6432c2` (2026-04-27 01:09): extracted `src/main/eliza/runtime-turn-runner.ts` and `src/main/pending-assistant-actions.ts`; important separation between Eliza runtime turns and pending/approved Bonzi assistant actions.
- Current anchors reported by git probe: `runtime-turn-runner.ts` owns create run → active run → `handleMessage` → complete/fail; `pending-assistant-actions.ts` gates runtime proposals into assistant actions; `workflow-action-instrumentation.ts` wraps plugin action handlers into workflow steps; `workflow-approval-coordinator.ts` owns approval wait/timeout.

## Investigator Findings

### 2026-04-27 deep trace: runtime turn stops at action-card boundary

**Verdict:** The main hypothesis is confirmed for Bonzi UI action cards. Bonzi runs exactly one runtime pass for a renderer command, converts extracted/proposed desktop actions into Bonzi `AssistantAction` cards, and then stops the workflow/runtime turn. Later card execution records an observation memory, but nothing re-enters `messageService.handleMessage()` or starts another runtime turn.

#### 1. Renderer command submit → main `sendCommand` → runtime turn → workflow completion → action cards

- Renderer submit is a single call into the assistant bridge: `src/renderer/assistant-command-controller.ts:50-53` disables input and awaits `window.bonzi.assistant.sendCommand({ command })`.
- Preload forwards that call over Electron IPC: `src/preload/index.ts:83-86` maps `assistant.sendCommand` to `invoke(IPC_CHANNELS.assistant.sendCommand, request)`.
- Main IPC is only a pass-through: `src/main/ipc.ts:219-221` handles `assistant.sendCommand` by returning `assistantService.sendCommand(request)`.
- `AssistantService.sendCommand` awaits the runtime turn first, then creates Bonzi action cards second: `src/main/assistant.ts:216-224` does `const runtimeTurn = await runtimeManager.sendCommand(...)` followed by `pendingActions.createActionsForRuntimeTurn(runtimeTurn.actions)`, and returns `reply`, `actions`, and `workflowRun` to the renderer.
- `BonziRuntimeManager.sendCommand` is only delegation: `src/main/eliza/runtime-manager.ts:302-304` returns `this.turnRunner.sendCommand(command)`.
- The actual single runtime pass is in `src/main/eliza/runtime-turn-runner.ts:51-154`:
  - `src/main/eliza/runtime-turn-runner.ts:64-74` creates one user `messageMemory`.
  - `src/main/eliza/runtime-turn-runner.ts:76-80` creates one workflow run for that command.
  - `src/main/eliza/runtime-turn-runner.ts:86-106` calls `messageService.handleMessage(...)` once inside `workflowManager.runWithActiveRun(...)` and records callback text/action counts.
  - `src/main/eliza/runtime-turn-runner.ts:110-121` reads `bundle.runtime.getActionResults(messageMemory.id)` and extracts/dedupes Bonzi proposed actions from action results, callbacks, and response content.
  - `src/main/eliza/runtime-turn-runner.ts:145-154` calls `workflowManager.completeRun(run.id, { replyText: reply })` and returns the already-completed run plus proposed actions.
- Pending card creation happens after the run is complete. `src/main/pending-assistant-actions.ts:34-55` creates a `pendingAction` for each proposal and stores it in `pendingActions`; if approvals are enabled, it returns the pending card immediately (`src/main/pending-assistant-actions.ts:42-45`). If approvals are disabled, it executes the action inline before the `sendCommand` response returns (`src/main/pending-assistant-actions.ts:47-52`), but this still occurs after `runtimeManager.sendCommand` has completed the workflow run.

#### 2. Pending action execution / auto-run → action executor → observation memory → no new turn

- Manual card execution goes renderer → IPC → `AssistantService.executeAction`: `src/renderer/conversation-controller.ts:238-254` calls `window.bonzi.assistant.executeAction({ actionId, confirmed })`; `src/main/ipc.ts:223-225` forwards to `assistantService.executeAction`; `src/main/assistant.ts:241-254` normalizes and returns `pendingActions.execute(...)`.
- Pending action execution has one terminal side effect: execute desktop action, then record memory. `src/main/pending-assistant-actions.ts:109-138` calls `executeAssistantAction(...)`; on success it builds a completed action and awaits `recordActionObservation` (`src/main/pending-assistant-actions.ts:116-124`), and on failure it records a failed observation (`src/main/pending-assistant-actions.ts:126-136`).
- The executor itself is a switch over local Electron/Discord/CUA operations, not a runtime loop. `src/main/assistant-action-executor.ts:64-118` handles action types such as `open-url`, `discord-read-context`, `discord-scroll`, and `discord-type-draft`, returning a string result.
- `recordActionObservation` is wired through `src/main/assistant.ts:100-107` into `runtimeManager.recordActionObservation`, which delegates to memory service at `src/main/eliza/runtime-manager.ts:293-299`.
- The observation recorder only writes a message memory. `src/main/eliza/runtime-memory-service.ts:44-75` normalizes the result text and calls `bundle.runtime.createMemory(createMessageMemory(...), 'messages')` with source `bonzi-action-observation`. It does not call `sendCommand`, `messageService.handleMessage`, `workflowManager.createRun`, or emit an event.
- Search evidence: the only source callers of `sendCommand(` are the renderer submit path, `assistant.ts`, `runtime-manager.ts`, and `runtime-turn-runner.ts` (`src/renderer/assistant-command-controller.ts:53`, `src/main/assistant.ts:200-218`, `src/main/eliza/runtime-manager.ts:302-304`, `src/main/eliza/runtime-turn-runner.ts:51`). There is no post-observation caller that re-enters the runtime.

**Conclusion:** Action observations become passive memory for a future user-initiated turn. They are not treated as an autonomous continuation signal.

#### 3. Workflow approvals/steps vs Bonzi pending action cards

- Workflow runs have statuses including terminal `completed`, `failed`, `cancelled`, and `interrupted`: `src/shared/contracts/workflow.ts:1-10`; `src/main/eliza/workflow-snapshot-utils.ts:260-267` defines these as terminal.
- `completeWorkflowRun` makes the run terminal without waiting for external cards: `src/main/eliza/workflow-state-transitions.ts:257-279` returns status `completed` unless already cancelled/terminal.
- `runtime-turn-runner` invokes that completion before returning actions to `assistant.ts`: `src/main/eliza/runtime-turn-runner.ts:145-154`.
- Bonzi UI cards do not carry workflow linkage. `AssistantAction` has only `id`, `type`, `title`, `description`, `requiresConfirmation`, `status`, `params`, and `resultMessage`: `src/shared/contracts/assistant.ts:44-57`. There is no `workflowRunId`, `workflowStepId`, `commandMessageId`, or continuation token.
- `createPendingAssistantAction` generates a new UUID and copies only presentation/action fields from the proposal: `src/main/assistant-action-presentation.ts:95-115`. It does not attach any workflow run or step metadata.
- `PendingAssistantActions` has no `BonziWorkflowManager` dependency: its options are shell state, companion window, approval settings, Discord service, and `recordActionObservation` (`src/main/pending-assistant-actions.ts:12-22`). Therefore card execution cannot update the original workflow even if it wanted to.
- Workflow step instrumentation exists for plugin actions, but it is separate from Bonzi UI cards. `src/main/eliza/workflow-action-instrumentation.ts:84-190` wraps a plugin action while there is an active run, starts/runs/completes/fails a workflow step, and optionally executes a Bonzi desktop proposal inline via a workflow gateway (`src/main/eliza/workflow-action-instrumentation.ts:237-334`). Those inline workflow-gateway actions are not the later pending UI-card path.
- Built-in Bonzi desktop actions are added directly in `buildRuntimePlugins` (`src/main/eliza/runtime-bootstrap.ts:36-55`), while `instrumentPluginActionsForWorkflow` is applied to plugins resolved by `BonziPluginRuntimeResolver` (`src/main/eliza/plugin-runtime-resolver.ts:120-128`). The pending UI-card path is therefore not modeled as a workflow step.

**Conclusion:** Pending Bonzi action cards are decoupled from workflow run/step IDs. The workflow does not remain active while those external action cards execute.

#### 4. Wait/pacing/observation requirements

- The renderer auto-run path for already-rendered cards has no central delay. When approvals are disabled, `src/renderer/approval-settings-controller.ts:118-126` updates runtime approval settings and then awaits `options.onApprovalsDisabled()`. `src/renderer/app.ts:136-138` clears pending confirmations and calls `conversationController.autoRunPendingActionCards()`.
- `autoRunPendingActionCards` serially executes every `pending` / `needs_confirmation` action with `confirmed: true`: `src/renderer/conversation-controller.ts:99-124`. There is no sleep, observation window, or runtime continuation between iterations.
- The main-process approvals-disabled path is also a tight serial loop: `src/main/pending-assistant-actions.ts:34-55` immediately calls `executePendingAction` for each proposal when `approvalsEnabled` is false.
- The only waits found are action-local implementation details, not orchestration pacing. Examples: Discord DOM readiness polls with `await delay(100)` in `src/main/discord-browser-service.ts:305-321`, and CUA typing passes `delay_ms: 10` in `src/main/cua-driver.ts:175-191`. These do not gate the Bonzi action loop or cause a runtime observation turn.

**Conclusion:** There is no centralized post-action delay, observation requirement, or plan/act/observe loop. The "observation" is only the memory write described above.

#### 5. Character/action-planning prompt/config

- Bonzi does enable elizaOS action planning at runtime construction: `src/main/eliza/runtime-lifecycle.ts:134-139` creates `new AgentRuntime({ ..., actionPlanning: true, llmMode: LLMMode.SMALL })`.
- Bonzi also prompts the character to use native elizaOS actions for desktop capabilities: `src/main/eliza/bonzi-character.ts:288-338` builds the default system prompt, including "Speak naturally and use native elizaOS actions..." and the available Bonzi desktop action list.
- However, the Bonzi bridge consumes the action plan/results only within one `handleMessage` call. `src/main/eliza/runtime-turn-runner.ts:86-121` calls `handleMessage` once, reads action results once, extracts proposed actions, and returns. The code after action-card execution never feeds the observation back into `handleMessage` automatically (`src/main/eliza/runtime-memory-service.ts:44-75`).

**Conclusion:** `actionPlanning: true` may help elizaOS choose/sequence actions inside a single runtime turn, but Bonzi's external Electron action-card boundary is outside that loop. Once an action leaves the runtime as a Bonzi UI card, action planning is no longer driving continuation.

### Recommended fix locations

1. **Introduce an explicit continuation runner near `src/main/eliza/runtime-turn-runner.ts` / `src/main/eliza/runtime-manager.ts`.** After a Bonzi action card completes and its observation is recorded, run a follow-up runtime turn with the original task context plus the observation. This should call `messageService.handleMessage` again, not merely write memory.
2. **Link cards to workflow context in `src/shared/contracts/assistant.ts`, `src/main/assistant-action-presentation.ts`, and `src/main/pending-assistant-actions.ts`.** Add workflow run/step IDs or a task/continuation ID to `AssistantAction` so external card execution can update or continue the correct workflow.
3. **Keep workflow runs non-terminal while external actions are outstanding.** Move `workflowManager.completeRun(...)` in `src/main/eliza/runtime-turn-runner.ts:145` behind pending external action completion/continuation, or introduce an `awaiting_user` / `awaiting_external_action` style state before completion.
4. **Centralize post-action pacing in `src/main/pending-assistant-actions.ts`.** After `executeAssistantAction` and `recordActionObservation`, optionally wait for a configured observation delay and then invoke the continuation runner. Renderer auto-run (`src/renderer/conversation-controller.ts:99-124`) should not be the primary orchestrator.
5. **Separate "proposal cards" from "workflow-executed actions."** `src/main/eliza/workflow-action-instrumentation.ts` already supports inline workflow-gateway execution. Decide whether Bonzi desktop actions should execute inside that workflow path or remain UI cards; if they remain cards, they need workflow IDs and continuation hooks.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The issue likely sits in runtime turn/action orchestration, workflow state transitions, or the assistant action execution loop.
**Findings:** Report created; external elizaOS action/task-loop behavior and Bonzi git history were gathered before workspace selection.
**Evidence:** User report on 2026-04-27; prior research recorded above.
**Conclusion:** Confirmed the investigation should focus on runtime turn boundaries, pending assistant actions, workflow status, and action observations.

### Phase 2 - Broad Context Gathering
**Hypothesis:** `context_builder` should find runtime/action/workflow paths that manual triage might miss.
**Findings:** Selection identified the command path, runtime turn runner, pending action boundary, workflow manager/state transitions, renderer action execution, and tests.
**Evidence:** Selected files include `src/main/eliza/runtime-turn-runner.ts`, `src/main/pending-assistant-actions.ts`, `src/main/eliza/runtime-memory-service.ts`, `src/main/assistant.ts`, renderer controllers, workflow contracts, and e2e tests.
**Conclusion:** The relevant system boundary spans main-process runtime orchestration, UI action cards, workflow tracking, and renderer IPC.

### Phase 3 - Pair Investigator Verification
**Hypothesis:** Bonzi completes one runtime turn before external action cards execute, then records action observations without continuing the runtime.
**Findings:** Confirmed. Detailed evidence is in `## Investigator Findings` above.
**Evidence:** Key refs: `runtime-turn-runner.ts:86-121`, `runtime-turn-runner.ts:145-154`, `assistant.ts:216-224`, `pending-assistant-actions.ts:34-55`, `pending-assistant-actions.ts:109-138`, `runtime-memory-service.ts:44-76`, `shared/contracts/assistant.ts:57-66`.
**Conclusion:** Root cause is architectural: no continuation orchestrator bridges external action completion back into elizaOS runtime planning.

### Phase 4 - Oracle Synthesis
**Hypothesis:** The verified evidence is sufficient to distinguish root cause from prompt/config/action failure theories.
**Findings:** Oracle confirmed this is not merely disabled `actionPlanning`, failed action persistence, renderer click handling, or workflow state-transition mutation. The missing piece is a scheduler/orchestrator that owns plan → act → observe → continue.
**Evidence:** `runtime-lifecycle.ts` enables `actionPlanning: true`; observations are persisted by `runtime-memory-service.ts`; workflow state exists but pending cards lack workflow IDs.
**Conclusion:** Proceed to fix planning around continuation metadata, non-terminal workflow states, runtime continuation API, main-process orchestration, pacing, events, and tests.

## Root Cause
Bonzi has three systems that are individually functional but not integrated into a multi-step executor:

1. **elizaOS runtime turn/action planning** — `src/main/eliza/runtime-turn-runner.ts:86-121` runs one `messageService.handleMessage(...)` pass, reads action results with `getActionResults(...)`, extracts proposed Bonzi actions, and stops.
2. **Bonzi action cards** — `src/main/assistant.ts:216-224` creates UI action cards only after `runtimeManager.sendCommand(...)` returns. `src/main/pending-assistant-actions.ts:109-138` later executes those cards and records observations.
3. **Workflow state tracking** — workflow runs and steps are tracked, but `src/main/eliza/runtime-turn-runner.ts:145-154` marks the run complete before external cards execute, and `src/shared/contracts/assistant.ts:57-66` gives `AssistantAction` no workflow/run/step/continuation correlation fields.

The exact break is after `PendingAssistantActions.executePendingAction(...)`: action execution calls `recordActionObservation`, but `src/main/eliza/runtime-memory-service.ts:44-76` only writes a `[Bonzi action observation: ...]` memory. It does not call `sendCommand`, `messageService.handleMessage`, create/continue a workflow run, or emit a continuation event.

Therefore action results become passive context for a future user prompt rather than active input to the current task. This explains both observed symptoms:

- **Stops after one task/action:** no automatic runtime re-entry after the first external action completes.
- **Executes too fast:** approvals-disabled/auto-run paths execute cards in tight loops without a central post-action wait, observation checkpoint, or continuation decision.

### Eliminated Hypotheses / Caveats
- **Not because `actionPlanning` is disabled:** `src/main/eliza/runtime-lifecycle.ts` enables `actionPlanning: true`.
- **Not because action results are never persisted:** `src/main/eliza/runtime-memory-service.ts:44-76` writes observations to memory.
- **Not primarily a renderer click/IPC failure:** renderer cards call `executeAction`, IPC forwards it, and main executes it.
- **Not just a workflow state-transition bug:** workflow state transitions exist; the missing piece is orchestration that resumes runtime after external action results.
- **Caveat:** elizaOS may still chain runtime-native plugin actions inside the single `handleMessage(...)` call. The failure applies to Bonzi's external Electron/UI action-card boundary.

## Recommendations
1. **Add workflow/continuation metadata to assistant actions.** Extend `src/shared/contracts/assistant.ts`, `src/main/eliza/runtime-action-proposals.ts`, `src/main/assistant-action-presentation.ts`, and `src/main/pending-assistant-actions.ts` with `workflowRunId`, `workflowStepId`, `commandMessageId`, and/or `continuationId` so executed cards can resume the right task.
2. **Keep workflows non-terminal while external actions are pending.** Change `src/main/eliza/runtime-turn-runner.ts` so it does not call `completeRun(...)` when actions are returned. Add or reuse a non-terminal status in `src/shared/contracts/workflow.ts`, `src/main/eliza/workflow-state-transitions.ts`, and `src/main/eliza/workflow-snapshot-utils.ts`, such as `awaiting_external_action`.
3. **Add a runtime continuation API.** Implement a method near `src/main/eliza/runtime-manager.ts` / `src/main/eliza/runtime-turn-runner.ts`, e.g. `continueWorkflowAfterObservation(...)`, that re-enters `messageService.handleMessage(...)` under the same workflow context with an explicit observation/continue message.
4. **Move autonomous orchestration into the main process.** `src/main/pending-assistant-actions.ts` should execute the action, record the observation, apply pacing, and call the continuation API. Renderer auto-run should not be the primary task scheduler.
5. **Add bounded loop controls.** Add settings/config for `maxContinuationSteps`, `maxWorkflowRuntimeMs`, `postActionDelayMs`, `minObservationDelayMs`, and stop reasons such as `final_reply`, `awaiting_user_approval`, `max_steps_reached`, `cancelled`, `action_failed`, and `runtime_error`.
6. **Extend assistant events for async continuation UI.** Add event contracts and handlers for continuation start/finish, new assistant messages, new action cards, and action updates in `src/shared/contracts/assistant.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/renderer/app.ts`, `src/renderer/conversation-controller.ts`, and `src/renderer/assistant-event-controller.ts`.
7. **Decide whether Bonzi desktop actions should execute inline or as UI cards.** `src/main/eliza/workflow-action-instrumentation.ts` already supports inline workflow-gateway execution for some proposals. If Bonzi keeps external cards, they must carry workflow IDs and resume hooks; if actions execute inline, approval/UX/event handling needs to keep pace with runtime waits.

## Preventive Measures
- Add e2e tests in `tests/e2e/bonzi.spec.ts` for: two-step continuation without a second user prompt; workflow remains non-terminal while cards are pending; action observation triggers a follow-up assistant message/action; approvals-disabled mode observes between steps; max-step guard; cancellation during pending action/approval.
- Add service/unit tests for: metadata propagation proposal → `AssistantAction`; `PendingAssistantActions` invoking a continuation hook after observation; `BonziRuntimeTurnRunner` avoiding `completeRun` when actions are pending; workflow transition coverage for awaiting external action; continuation prompt construction.
- Add structured telemetry/events for `runtime_turn_started`, `runtime_turn_completed`, `actions_proposed`, `pending_action_created`, `pending_action_executed`, `action_observation_recorded`, `continuation_scheduled`, `continuation_started`, `continuation_completed`, and `workflow_stopped`, including workflow/action IDs, step index, elapsed time, approval mode, stop reason, and errors.
- Keep multi-step behavior documented as an architectural contract: Bonzi should implement plan → act → observe → continue → repeat → finish, not just single turn → proposed action cards → memory observation.
