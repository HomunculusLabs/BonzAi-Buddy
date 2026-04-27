# Investigation: Plugin Install Incompatible Registry Metadata

## Summary
Plugin install cards show `@bealers/plugin-mattermost@0.5.1` as incompatible with a fallback description because the live generated Eliza registry entry has `description: null` and `supports.alpha: false`, and Bonzi's registry normalizer treats those as missing-description and globally-incompatible signals. npm has richer metadata, but Bonzi does not query/enrich from npm during discovery.

## Symptoms
- Plugin install UI shows an `INCOMPATIBLE` badge for registry plugins.
- Plugin card says plugin metadata was discovered from registry but has no description.
- Warning shown: "Registry entry did not include a description. | Registry marked this plugin as incompatible."
- Example from screenshot: `@bealers/plugin-mattermost`, version `0.5.1`, tags `Source registry` and `Policy confirm_each_action`.

## Background / Prior Research
- **External package metadata for `@bealers/plugin-mattermost@0.5.1`:** npm registry metadata includes description `Mattermost client plugin for ElizaOS - enables AI agent integration with Mattermost chat platforms`, latest dist-tag `0.5.1`, license MIT, author `bealers`, keywords, repository `https://github.com/bealers/plugin-mattermost`, and no `peerDependencies` or `engines`. Runtime dependencies include floating `@elizaos/core: "latest"`, `@elizaos/plugin-bootstrap: 1.0.15`, and `@elizaos/plugin-openai: 1.0.6`. Sources reported by explore probe: `https://www.npmjs.com/package/@bealers/plugin-mattermost`, `https://registry.npmjs.org/@bealers/plugin-mattermost/0.5.1`.
- **External Eliza plugin registry metadata:** `@bealers/plugin-mattermost` is listed in the public registry index as `github:bealers/plugin-mattermost`; there is also an official-looking separate `@elizaos/plugin-mattermost` entry at `github:elizaos-plugins/plugin-mattermost`. Source reported by explore probe: `https://raw.githubusercontent.com/elizaos-plugins/registry/refs/heads/main/index.json`.
- **Git archaeology:** Plugin registry normalization/cache/client/merge files were introduced together in commit `4f83276` on April 26, 2026. The warning strings `Registry entry did not include a description.` and `Registry marked this plugin as incompatible.` were introduced in `src/main/eliza/plugin-registry-normalization.ts` in that commit. The installer and renderer were refactored into their current shape in commit `d6432c2` on April 27, 2026.
- **Compatibility clue from archaeology:** Incompatibility is computed in `normalizeRegistryPluginEntry()` from fields like `compatible === false`, `supported === false`, compatibility metadata containing `compatible:false`/`supported:false`, or `supports.alpha === false`. The current screenshot warning maps directly to that normalization path and then to `renderAvailablePluginCard()` rendering `plugin.warnings`.

## Investigator Findings

### 2026-04-27 - Registry-to-card trace

#### Verdict
The screenshot behavior for `@bealers/plugin-mattermost@0.5.1` is caused by **external Eliza generated-registry metadata plus Bonzi registry normalization**. The renderer and installer are mostly pass-through:

- **Missing description:** external generated registry has `description: null`; Bonzi only reads top-level `description` / `summary`, not npm package metadata.
- **`INCOMPATIBLE` badge:** external generated registry has `supports.alpha: false`; Bonzi treats `supports.alpha === false` as a global incompatible signal.
- **Renderer:** displays normalized `description`, `lifecycleStatus`, and `warnings` as received.
- **Installer policy:** does not block because of `incompatible`; it blocks only when `packageName` is missing.

#### Live external payload evidence
Bonzi's default registry URL is `https://raw.githubusercontent.com/elizaos-plugins/registry/main/generated-registry.json` (`src/main/eliza/plugin-discovery.ts:15-16`). Fetched on 2026-04-27, the live `@bealers/plugin-mattermost` entry in that generated registry is:

```json
{
  "git": { "repo": "bealers/plugin-mattermost", "v0": { "version": "v0.5.0" }, "v1": { "version": null }, "alpha": { "version": null } },
  "npm": { "repo": "@bealers/plugin-mattermost", "v0": "0.5.1", "v1": null, "alpha": null, "v0CoreRange": "latest", "v1CoreRange": null, "alphaCoreRange": null },
  "supports": { "v0": false, "v1": false, "alpha": false },
  "description": null,
  "homepage": null,
  "topics": [],
  "stargazers_count": 0,
  "language": "TypeScript"
}
```

Npm itself still has richer package metadata for `@bealers/plugin-mattermost@0.5.1`, including description `Mattermost client plugin for ElizaOS - enables AI agent integration with Mattermost chat platforms`, license `MIT`, homepage `https://elizaos.ai`, and repository `https://github.com/bealers/plugin-mattermost`. Bonzi does not currently query npm during registry discovery.

#### Registry payload -> normalization
- `normalizeRegistryPayload()` accepts object-map registry collections and injects the object key as `id` when an entry lacks `id` (`src/main/eliza/plugin-registry-normalization.ts:39-56`). For generated-registry, this turns the map key `@bealers/plugin-mattermost` into the normalized entry id.
- Package name can come from nested npm metadata: `readString(npmMetadata?.repo)` (`src/main/eliza/plugin-registry-normalization.ts:86-92`), so the live `npm.repo: "@bealers/plugin-mattermost"` supplies the package name.
- Version can come from nested npm metadata via `readNpmVersion(npmMetadata)` (`src/main/eliza/plugin-registry-normalization.ts:149-153`, helper at `219-238`), so `npm.v0: "0.5.1"` becomes the card version.
- Description only checks `item.description` and `item.summary`, then falls back to `Plugin metadata was discovered from registry but has no description.` (`src/main/eliza/plugin-registry-normalization.ts:130-133`). Because the live registry has `description: null`, it also pushes `Registry entry did not include a description.` (`src/main/eliza/plugin-registry-normalization.ts:135-137`).
- Compatibility collects `supports` booleans into metadata (`src/main/eliza/plugin-registry-normalization.ts:110-116`), then computes incompatible if `item.compatible === false`, `item.supported === false`, metadata contains `compatible:false` / `supported:false`, **or `alphaSupported === false`** (`src/main/eliza/plugin-registry-normalization.ts:118-124`). The live payload has `supports.alpha: false`, so Bonzi marks it incompatible.
- The normalized return sets `lifecycleStatus: incompatible ? 'incompatible' : 'available'`, `executionPolicy: 'confirm_each_action'`, and appends `Registry marked this plugin as incompatible.` (`src/main/eliza/plugin-registry-normalization.ts:166-170`).

#### Normalization -> merge/projection
- Discovery loads settings, persisted inventory, then registry entries, and calls `mergeRegistryEntries(state, loadedRegistry.entries)` (`src/main/eliza/plugin-discovery.ts:50-68`).
- For registry-only plugins, merge creates an available entry from normalized registry fields: `id`, `name`, `packageName`, `version`, `description`, `source`, `lifecycleStatus`, `executionPolicy`, `compatibility`, `warnings`, and `errors` (`src/main/eliza/plugin-discovery-merge.ts:198-213`).
- If a registry entry is incompatible, merge preserves that status on the available card: `registryEntry.lifecycleStatus === 'incompatible' ? 'incompatible' : ...` (`src/main/eliza/plugin-discovery-merge.ts:224-228`).
- Registry warnings are appended into the UI-facing available entry (`src/main/eliza/plugin-discovery-merge.ts:239-240`) and inventory entry (`src/main/eliza/plugin-discovery-merge.ts:279-293`).
- The pre-registry built-in projection is not the source of this card: `buildPluginSettings()` only builds required plugins, optional Bonzi built-ins, and persisted unknown installed plugins before registry merge (`src/main/eliza/plugin-settings-projection.ts:17-68`).

#### Main/preload/renderer card flow
- IPC/preload/data-client layers are pass-through for discovery: `ipc.ts` returns `assistantService.discoverPlugins(request)` (`src/main/ipc.ts:125-127`), preload invokes `IPC_CHANNELS.plugins.discover` (`src/preload/index.ts:62-66`), and the renderer data client returns `bridge.plugins.discover(...)` (`src/renderer/plugin-settings-data-client.ts:31-45`).
- The available card status label comes from `normalizeStatus(plugin)` using `plugin.lifecycleStatus` (`src/renderer/plugin-settings-view.ts:14-21`) and is title-cased by `formatStatusLabel()` (`src/renderer/plugin-settings-view.ts:24-30`). Thus `incompatible` displays as `Incompatible`.
- The card renders `plugin.description` directly (`src/renderer/plugin-settings-view.ts:210-211`) and renders warnings by joining `plugin.warnings` with ` | ` (`src/renderer/plugin-settings-view.ts:54-67`, used at `213`).
- The metadata tags in the screenshot are also direct fields: package/version/source/policy are pushed in `renderAvailablePluginCard()` (`src/renderer/plugin-settings-view.ts:162-176`).

#### Install flow / policy
- The renderer install flow looks up the available plugin and returns early for built-ins only (`src/renderer/plugin-settings-flows.ts:120-126`).
- It hard-blocks only if `availablePlugin.packageName` is missing, with the message `Cannot install this plugin because registry metadata did not include a package name.` (`src/renderer/plugin-settings-flows.ts:128-133`). There is no `lifecycleStatus === 'incompatible'` block.
- Install requests send `id`, `pluginId`, `packageName`, `versionRange`, and confirmation fields to the main process (`src/renderer/plugin-settings-flows.ts:144-151`, `182-190`).
- Main installer normalization only requires `packageName` (`src/main/eliza/plugin-installer-normalization.ts:8-25`), and the installer preview/execute path does not check lifecycle compatibility (`src/main/eliza/plugin-installer.ts:75-178`).
- Runtime approval settings can auto-confirm when approvals are disabled, but still do not consult compatibility status (`src/main/eliza/runtime-manager.ts:202-218`).

#### Tests and cache findings
- Existing E2E coverage has a fake registry test at `tests/e2e/bonzi.spec.ts:625-691`. It verifies a described compatible `weather` plugin and an incompatible `legacy-bot` plugin.
- The fake incompatible case uses `compatibility: { compatible: false }` (`tests/e2e/bonzi.spec.ts:988-993`) and asserts `lifecycleStatus === 'incompatible'` plus `Registry marked this plugin as incompatible.` (`tests/e2e/bonzi.spec.ts:659-664`).
- No current fake-registry test covers `description: null` / missing description fallback, and no test covers `supports: { alpha: false }` as the trigger.
- Registry cache stores **normalized** `RegistryPluginEntry[]`, not raw registry JSON: the cache type is `entries: RegistryPluginEntry[]` (`src/main/eliza/plugin-registry-cache.ts:9-14`) and the client writes only `normalized.entries` (`src/main/eliza/plugin-registry-client.ts:60-68`).
- Cache file is `eliza-plugin-registry-cache.v1.json` with 30-minute TTL (`src/main/eliza/plugin-registry-cache.ts:6-7`) under Electron `userData` by default (`src/main/eliza/plugin-discovery.ts:32-35`).
- A fresh cache hit returns cached entries without re-normalizing (`src/main/eliza/plugin-registry-client.ts:28-40`), so per-entry fallback descriptions/warnings/incompatible statuses baked by an older normalizer can persist until force refresh, TTL expiry with successful network refresh, cache deletion, or cache schema/version change. If refresh fails, the client uses cached entries even after TTL expiry and adds a generic refresh warning (`src/main/eliza/plugin-registry-client.ts:75-87`).

#### Root-cause classification
| Layer | Finding |
|---|---|
| External registry metadata | **Contributing/root input.** Live generated registry has package/version support fields but `description: null` and `supports.alpha: false` for `@bealers/plugin-mattermost`. |
| Bonzi normalization | **Primary Bonzi root cause.** It does not enrich description from npm metadata and treats `supports.alpha === false` as globally incompatible. |
| Merge/projection | **Expected propagation.** Merge preserves normalized incompatible status and warnings for available registry entries. |
| Renderer card | **Expected display.** It title-cases `lifecycleStatus`, prints `description`, and joins warnings. |
| Installer policy | **Not the cause.** Install is not blocked by incompatible status; only missing package name blocks before preview/install. |
| Cache | **Can preserve stale symptoms.** It stores normalized entries, so old per-entry warnings/statuses can survive until cache refresh or invalidation. |

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The install UI is surfacing normalized registry metadata warnings. The root cause may be external registry metadata missing fields, compatibility normalization being too strict, or a merge/projection bug between registry discovery and installer UI.
**Findings:** Report created for read-only investigation. No source changes will be made.
**Evidence:** User-provided screenshot of the plugin install card.
**Conclusion:** Needs workspace context and external metadata check.

### Phase 1.5 - External Metadata and Git History
**Hypothesis:** The example package may be missing metadata externally, or the warning behavior may have been recently introduced.
**Findings:** npm metadata for `@bealers/plugin-mattermost@0.5.1` includes a real description and package details, but the live generated Eliza registry entry has `description: null` and `supports: { v0:false, v1:false, alpha:false }`. Git archaeology showed the warning strings and registry normalizer were introduced in commit `4f83276` on April 26, 2026.
**Evidence:** npm package page / registry JSON; generated registry URL `https://raw.githubusercontent.com/elizaos-plugins/registry/main/generated-registry.json`; `src/main/eliza/plugin-registry-normalization.ts` warning logic.
**Conclusion:** External generated registry shape is a confirmed input; npm package metadata is not the source of the missing-description warning.

### Phase 2-4 - Workspace Trace and Synthesis
**Hypothesis:** One of normalization, merge/projection, renderer, cache, or installer policy is creating the visible card state.
**Findings:** Registry normalization creates both the fallback description warning and the incompatible lifecycle; merge and renderer faithfully propagate/display those fields; installer policy does not block incompatible plugins; cache stores normalized entries and can preserve stale normalized statuses.
**Evidence:** `src/main/eliza/plugin-registry-normalization.ts:86-92,110-137,149-170`; `src/main/eliza/plugin-discovery-merge.ts:198-240`; `src/renderer/plugin-settings-view.ts:14-30,54-67,162-213`; `src/renderer/plugin-settings-flows.ts:128-133`; `src/main/eliza/plugin-registry-client.ts:28-40,60-68,75-87`; `src/main/eliza/plugin-registry-cache.ts:6-14`.
**Conclusion:** Root cause confirmed as sparse generated registry metadata plus Bonzi normalization behavior.

## Root Cause
The card is showing the exact state produced by Bonzi's registry normalization for the live generated registry entry.

For `@bealers/plugin-mattermost`, the generated registry supplies package and version metadata through nested npm fields, but its description is `null` and all support flags are false. Bonzi can recover package name from `npm.repo` and version from `npm.v0`, but `normalizeRegistryPluginEntry()` only checks top-level `description` / `summary` before using the fallback text and pushing `Registry entry did not include a description.` (`src/main/eliza/plugin-registry-normalization.ts:86-92,130-137,149-153`).

The `INCOMPATIBLE` badge comes from the same normalizer: it folds `supports` booleans into compatibility metadata and treats `supports.alpha === false` as a global incompatible signal (`src/main/eliza/plugin-registry-normalization.ts:110-124`), then sets `lifecycleStatus: 'incompatible'` and appends `Registry marked this plugin as incompatible.` (`src/main/eliza/plugin-registry-normalization.ts:166-170`).

The downstream layers are not inventing the issue. `mergeRegistryEntries()` preserves that status and warnings for available plugin entries (`src/main/eliza/plugin-discovery-merge.ts:198-240`), and the renderer formats/displays lifecycle, description, and warnings directly (`src/renderer/plugin-settings-view.ts:14-30,54-67,162-213`). The installer flow does not block on `incompatible`; it only blocks when `packageName` is missing (`src/renderer/plugin-settings-flows.ts:128-133`).

## Recommendations
1. **Broaden description handling in `src/main/eliza/plugin-registry-normalization.ts`.** Read any available nested/package description fields before falling back; if generated registry remains sparse, consider npm enrichment only for missing descriptions.
2. **Make compatibility runtime-aware.** Do not treat `supports.alpha === false` as globally incompatible unless Bonzi is explicitly evaluating an alpha runtime. Preserve support flags as metadata/warnings unless they prove incompatibility for the active runtime line.
3. **Align UI language with actual policy.** If install is still allowed, consider labels like `Unsupported`, `Untested`, or `Registry unsupported` instead of hard `Incompatible`; if `Incompatible` should be authoritative, enforce it in install flow too.
4. **Invalidate or rework registry cache after normalization changes.** Cache currently stores normalized entries under `eliza-plugin-registry-cache.v1.json` with a 30-minute TTL, so stale fallback descriptions/statuses can persist (`src/main/eliza/plugin-registry-cache.ts:6-14`; `src/main/eliza/plugin-registry-client.ts:28-40,60-68,75-87`). Bump cache version, store raw payload, or include a normalizer version.
5. **Add regression coverage.** Extend tests for generated-registry-style entries: `description: null`, nested `npm.repo`/`npm.v0`, `supports.alpha:false`, and explicit hard-incompatible cases such as `compatibility.compatible:false`.

## Preventive Measures
- Keep registry normalization tests aligned with the real generated registry schema.
- Separate "unknown/unsupported for this runtime" from "globally incompatible" in shared lifecycle semantics.
- Prefer caching raw registry payloads or versioning cached normalized output whenever normalization semantics change.
- Add a UI/installer contract test ensuring status labels and install blocking policy cannot drift apart silently.
