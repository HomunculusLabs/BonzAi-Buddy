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

Validated during Item 4 completion:

- `npm run typecheck` ✅
- `npm run build` ✅
