# Bonzi Desktop Companion (MVP)

Electron + Vite + TypeScript desktop companion that renders a VRM avatar in a transparent always-on-top window and routes assistant commands through a typed IPC boundary.

## Requirements

- Node.js 20+
- npm 10+
- macOS (primary target for this MVP)

## Dev setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template:
   ```bash
   cp .env.example .env
   ```
3. Choose provider config in `.env` (see below).
4. Start dev app:
   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev` — run Electron + Vite in development
- `npm run typecheck` — TypeScript checks for main/preload/renderer
- `npm run build` — production build via `electron-vite`
- `npm run preview` — preview built app

## VRM asset behavior

- Runtime VRM path is `./static/7120171664031727876.vrm` (from `src/main/shell-state.ts`).
- The renderer loads that path from `public/static/7120171664031727876.vrm`.
- If you swap models, either:
  - keep the same filename in `public/static`, or
  - update `VRM_ASSET_PATH` in `src/main/shell-state.ts` to your new static path.
- On load failure, UI shows status/error text and exposes a retry button.

## Runtime animation asset pipeline

Bonzi supports three animation sources for stage motion, in this order:

1. real VRM Animation (`.vrma`)
2. Mixamo FBX animation (`.fbx`) retargeted at runtime onto the loaded VRM humanoid
3. built-in authored fallback clips

Per animation slot, Bonzi prefers these files in `public/static/animations`:

- idle:
  - `public/static/animations/idle.vrma`
  - else `public/static/animations/idle.fbx`
- wave/emote:
  - `public/static/animations/wave.vrma`
  - else `public/static/animations/wave.fbx`

They are served at runtime as:

- `./static/animations/idle.vrma`
- `./static/animations/idle.fbx`
- `./static/animations/wave.vrma`
- `./static/animations/wave.fbx`

The stage status text reports which source is active for each slot (`real VRMA`, `Mixamo FBX`, or `built-in fallback`).

### Mixamo download instructions

We cannot automate Adobe login or asset downloads, but Bonzi can use Mixamo FBX files that you download yourself.

1. Sign in to Mixamo with your Adobe ID: https://www.mixamo.com/
2. Pick an animation for idle and/or wave.
3. Download each animation as FBX with these settings when available:
   - **Format:** `FBX`
   - **Skin:** `Without Skin` / `No Skin`
   - **Frames Per Second:** `30`
   - **Keyframe Reduction:** `None` / disabled
4. Save the files as:
   - `public/static/animations/idle.fbx`
   - `public/static/animations/wave.fbx`
5. Start or reload the app. Bonzi will retarget the Mixamo tracks to the loaded VRM humanoid at runtime.

### VRMA notes

- VRM Animation is the official cross-model humanoid animation format: https://vrm.dev/en/vrma/
- VRoid's official Photo Booth help says you can use your own `.vrma` files and browse purchasable items under the `#VRMA` tag on BOOTH: https://vroid.pixiv.help/hc/en-us/articles/28973617114777-How-to-Use-the-Photo-Booth
- We do **not** bundle third-party `.vrma` or Mixamo FBX animation files in this repo. Bring your own files.

### Terms / rights reminder

- Check the license and usage terms for both the VRM model and any motion asset you use.
- For `.vrma` files, VRoid's help explicitly notes that you should check both the model's conditions of use and any separate terms specified by the `.vrma` rights holder.
- Mixamo assets are subject to Adobe/Mixamo terms. Do **not** redistribute raw Mixamo FBX files unless your license/terms allow it.
- This repo ignores local `public/static/animations/*.fbx` and `*.vrma` files by default so user-supplied animation assets are not accidentally committed.
- General VRM licensing reference: https://vrm.dev/licenses/1.0/pdf/en.pdf

## LLM provider config

`.env.example` supports two provider modes:

- `BONZI_ASSISTANT_PROVIDER=mock`
  - Offline-safe mock behavior for local testing.
- `BONZI_ASSISTANT_PROVIDER=openai-compatible`
  - Use this for Z.AI or any OpenAI-compatible chat/completions API.
  - Requires `BONZI_OPENAI_API_KEY`.
  - Optional overrides:
    - `BONZI_OPENAI_BASE_URL`
    - `BONZI_OPENAI_MODEL`
    - `BONZI_OPENAI_SYSTEM_PROMPT`

### Z.AI setup

Use these values in `.env`:

```env
BONZI_ASSISTANT_PROVIDER=openai-compatible
BONZI_OPENAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
BONZI_OPENAI_API_KEY=your-z-ai-api-key
BONZI_OPENAI_MODEL=GLM-5.1
```

Supported model examples:

- `GLM-5.1`
- `GLM-5`
- `GLM-5-Turbo`
- `GLM-4.7`
- `GLM-4.5-air`

If `openai-compatible` is selected without an API key, the app falls back to the mock provider and emits a warning in shell state/chat.

## Pi / local-server extension point

This MVP already supports OpenAI-compatible endpoints via `BONZI_OPENAI_BASE_URL`, including Z.AI. You can also point Bonzi to a Raspberry Pi or LAN-hosted service that implements compatible `/chat/completions` behavior.

For a new provider implementation, extend provider selection in:

- `src/main/assistant.ts` (`selectProvider`, provider factory functions)
- `src/shared/contracts.ts` (`AssistantProviderKind` if needed)

## Safety model

Assistant actions are intentionally constrained:

- Responses are normalized to JSON and action proposals are filtered to an allowlist.
- Executable action types are limited to:
  - `report-shell-state`
  - `copy-vrm-asset-path`
  - `minimize-window`
  - `close-window`
- `close-window` requires explicit confirmation before execution.
- No unrestricted shell command execution is exposed in preload/main IPC.

## macOS desktop notes

- Companion window is transparent, frameless, always-on-top, and resizable.
- On macOS, it is configured to be visible across workspaces (including fullscreen spaces) and hides standard traffic-light buttons.
- Standard macOS lifecycle is respected (`window-all-closed` does not quit app on darwin).

## Validation snapshot

Latest local validation:

- `npm run typecheck` ✅
- `npm run build` ✅
