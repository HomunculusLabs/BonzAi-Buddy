# Bonzi Desktop Companion (MVP)

Electron + Vite + TypeScript desktop companion that renders a VRM avatar in a transparent always-on-top window.

Bonzi now runs an embedded **Eliza runtime** in the Electron main process. The renderer UI (speech bubble/chat/action chips + VRM stage) stays Bonzi-native and talks to main through typed IPC.

## Requirements

- Node.js 20+
- Bun 1.2+
- macOS (primary target for this MVP)

## Dev setup

1. Install dependencies:
   ```bash
   bun install
   ```
2. Copy env template:
   ```bash
   cp .env.example .env
   ```
3. Configure runtime provider in `.env` (see below).
4. Start dev app:
   ```bash
   bun run dev
   ```

## Scripts

- `bun run dev` — run Electron + Vite in development
- `bun run typecheck` — TypeScript checks for main/preload/renderer
- `bun run build` — production build via `electron-vite`
- `bun run preview` — preview built app
- `bun run test:e2e` — build the app and run the Playwright Electron smoke tests
- `bun run embeddings:check` — probe the configured Bonzi-managed embeddings upstream and verify the returned dimension matches Bonzi/Eliza expectations
- `./scripts/run-local-embeddings-server.sh` — create/update a local Python venv and start the repo-local OpenAI-compatible embeddings server on port `8999` by default

## Runtime architecture (Bonzi → Eliza)

- Electron main owns one Eliza `AgentRuntime` (`src/main/eliza/runtime-manager.ts`).
- Runtime conversation history is persisted through `@elizaos/plugin-localdb`.
- Renderer hydrates chat from `assistant:get-history` and listens to `assistant:event`.
- Runtime settings cover plugins, action approvals, continuation limits, and character overrides (`src/main/eliza/plugin-settings.ts`).
- Workflow runs are tracked separately from chat history so multi-step runtime/plugin actions can expose progress, approval waits, cancellation, and continuation state (`src/main/eliza/workflow-manager.ts`).
- Desktop actions remain Bonzi-owned and confirmation-aware (`src/main/assistant.ts`), not direct unrestricted runtime execution.
- Bonzi does **not** run the full Eliza API server or adopt stock app-companion UI in this migration phase.

## Local persistence

Bonzi stores runtime data under Electron user data. On macOS this is typically:

- `~/Library/Application Support/bonzi/`

Important files/directories:

- `eliza-localdb/` — Eliza local database used for conversation history and runtime memory.
- `bonzi-settings.json` — Bonzi runtime settings: plugin inventory, enabled/disabled state, approval settings, continuation limits, and character overrides.
- `bonzi-workflow-runs.json` — recent workflow run snapshots and step status.

The renderer loads persisted chat history and recent workflow state on startup. Action chips for ordinary one-turn actions remain turn-local unless they are part of a persisted workflow run.

## Settings panel

The renderer settings panel is split into runtime-focused sections:

- **Plugins** — shows required plugins (`localdb`, provider), Bonzi built-ins (`bonzi-context`, `bonzi-desktop-actions`), and discovered registry/local/installed plugins. Third-party installs run through a user-data plugin workspace and require explicit confirmation before `bun add`; installed plugins are saved disabled by default.
- **Action approvals** — controls whether runtime/plugin actions need approval prompts. Disabling approvals requires an explicit confirmation flag, and actions still stay inside Bonzi's allowlist.
- **Continuation pacing** — controls multi-step continuation limits: max steps, max runtime, and post-action delay.
- **Character editor** — lets the user override safe Eliza character fields such as identity, system prompt, bio, lore/memory, topics, adjectives, and style. Unsupported runtime fields such as plugins, actions, providers, secrets, and embedded knowledge sources are rejected.
- **Knowledge import** — imports Markdown files into elizaOS runtime memory/RAG. The renderer reads selected `.md` files as text and sends them over IPC; paths and imported Markdown are not saved in Bonzi settings.

Knowledge import limits are enforced in both renderer and main:

- up to 20 Markdown files per import
- max 1 MiB per file
- max 5 MiB total request size
- max 500 generated chunks per import

Markdown is normalized, split by headings/paragraphs where possible, and each chunk is tagged with its source filename before import.

## Provider mapping / env behavior

`.env.example` supports these modes via `BONZI_ASSISTANT_PROVIDER`:

- `eliza-classic`
  - Local Eliza Classic fallback mode.
- `openai-compatible`
  - Uses OpenAI-compatible APIs (Z.AI or compatible self-hosted endpoints).
  - Requires `BONZI_OPENAI_API_KEY`.
  - Optional overrides:
    - `BONZI_OPENAI_BASE_URL`
    - `BONZI_OPENAI_MODEL`
    - `BONZI_OPENAI_SYSTEM_PROMPT`
  - Optional direct embedding-specific overrides (for separate embedding provider/model config):
    - `BONZI_OPENAI_EMBEDDING_MODEL` → maps to `OPENAI_EMBEDDING_MODEL`
    - `BONZI_OPENAI_EMBEDDING_URL` → maps to `OPENAI_EMBEDDING_URL`
    - `BONZI_OPENAI_EMBEDDING_API_KEY` → maps to `OPENAI_EMBEDDING_API_KEY`
    - `BONZI_OPENAI_EMBEDDING_DIMENSIONS` (must be one of `384`, `512`, `768`, `1024`, `1536`, `3072`) → maps to `OPENAI_EMBEDDING_DIMENSIONS`
  - Optional Bonzi-managed embeddings service:
    - Set both `BONZI_EMBEDDINGS_UPSTREAM_URL` and `BONZI_EMBEDDINGS_UPSTREAM_MODEL` to enable a local loopback `/v1/embeddings` proxy owned by Bonzi.
    - Optional companion vars:
      - `BONZI_EMBEDDINGS_UPSTREAM_API_KEY`
      - `BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY` (`strict` or `matryoshka-truncate`)
      - `BONZI_EMBEDDINGS_SERVICE_PORT`
      - `BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS`
    - In this mode Bonzi probes the upstream before startup, verifies the returned vector length matches `BONZI_OPENAI_EMBEDDING_DIMENSIONS` (or the default `1536`), and then points Eliza at the local proxy instead of the upstream directly.
- `mock` (legacy alias)
  - Accepted for compatibility, but mapped to `eliza-classic` with a warning.

If `openai-compatible` is selected without an API key, Bonzi falls back to `eliza-classic` and reports a warning in shell state/chat. Embedding overrides are optional; if omitted, Eliza/OpenAI plugin defaults are used. If `BONZI_OPENAI_EMBEDDING_DIMENSIONS` is provided but not one of Bonzi/Eliza's supported values (`384`, `512`, `768`, `1024`, `1536`, `3072`), Bonzi ignores it and emits a startup warning.

### Recommended external embeddings server: repo-local Python server

Bonzi’s recommended non-LM-Studio stack is now the **repo-local Python embeddings server** in this repo.

Why this stack:

- It runs outside LM Studio and exposes a real OpenAI-compatible `POST /v1/embeddings` plus `GET /v1/models`.
- It works well with Qwen’s Matryoshka embedding models through `sentence-transformers`, so Bonzi can request compatible output sizes directly instead of hoping the upstream honors them.
- On Apple Silicon it prefers **MPS** automatically when available, with CPU fallback if needed.
- It keeps Bonzi’s existing local loopback embeddings proxy intact, so `bun run embeddings:check` still validates the upstream before runtime startup.

Two practical profiles:

1. **Preferred Mac Studio profile** — `Qwen/Qwen3-Embedding-4B` on MPS at **1536** dims
   - This is the preferred stronger-than-nomic path for Apple Silicon in this repo.
   - `Qwen/Qwen3-Embedding-4B` supports output sizes up to **2560**, but Bonzi/Eliza currently only accepts `384`, `512`, `768`, `1024`, `1536`, or `3072`.
   - That makes **1536** the best compatible default today.
2. **Safe tested fallback** — `Qwen/Qwen3-Embedding-0.6B` at **1024** dims
   - Easier to host locally if 4B is too heavy or flaky on your machine.
   - Still a meaningful upgrade over the previous LM Studio + Nomic workaround.

### Bonzi-managed embeddings service setup

Use this when you want Bonzi to keep owning the local loopback proxy that Eliza talks to while the Python server acts as the upstream on `127.0.0.1:8999`.

#### Start the local Python embeddings server

From the repo root:

```bash
./scripts/run-local-embeddings-server.sh
```

What the helper script does:

- prefers `python3.12`, then `python3.11`, then `python3`
- creates `.venv-local-embeddings` if needed
- installs `python/requirements-embeddings.txt` when the requirements file changes
- uses a repo-local Hugging Face cache under `.cache/huggingface`
- exports `PYTORCH_ENABLE_MPS_FALLBACK=1`
- starts `python/embeddings_server.py`

#### Preferred profile: Qwen3-Embedding-4B @ 1536 on port 8999

```env
BONZI_ASSISTANT_PROVIDER=openai-compatible
BONZI_OPENAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
BONZI_OPENAI_API_KEY=your-z-ai-api-key
BONZI_OPENAI_MODEL=GLM-5.1

BONZI_OPENAI_EMBEDDING_DIMENSIONS=1536
BONZI_EMBEDDINGS_UPSTREAM_URL=http://127.0.0.1:8999/v1
BONZI_EMBEDDINGS_UPSTREAM_MODEL=Qwen/Qwen3-Embedding-4B
BONZI_EMBEDDINGS_UPSTREAM_API_KEY=
BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY=strict
# optional: 0 = ephemeral loopback port chosen by Bonzi
BONZI_EMBEDDINGS_SERVICE_PORT=0
BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS=30000

BONZI_LOCAL_EMBEDDINGS_HOST=127.0.0.1
BONZI_LOCAL_EMBEDDINGS_PORT=8999
BONZI_LOCAL_EMBEDDINGS_MODEL=Qwen/Qwen3-Embedding-4B
BONZI_LOCAL_EMBEDDINGS_DEVICE=auto
BONZI_LOCAL_EMBEDDINGS_DIMENSIONS=1536
BONZI_LOCAL_EMBEDDINGS_BATCH_SIZE=8
BONZI_LOCAL_EMBEDDINGS_TORCH_DTYPE=auto
```

#### Safe fallback profile: Qwen3-Embedding-0.6B @ 1024

```env
BONZI_ASSISTANT_PROVIDER=openai-compatible
BONZI_OPENAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
BONZI_OPENAI_API_KEY=your-z-ai-api-key
BONZI_OPENAI_MODEL=GLM-5.1

BONZI_OPENAI_EMBEDDING_DIMENSIONS=1024
BONZI_EMBEDDINGS_UPSTREAM_URL=http://127.0.0.1:8999/v1
BONZI_EMBEDDINGS_UPSTREAM_MODEL=Qwen/Qwen3-Embedding-0.6B
BONZI_EMBEDDINGS_UPSTREAM_API_KEY=
BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY=strict
BONZI_EMBEDDINGS_SERVICE_PORT=0
BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS=30000

BONZI_LOCAL_EMBEDDINGS_HOST=127.0.0.1
BONZI_LOCAL_EMBEDDINGS_PORT=8999
BONZI_LOCAL_EMBEDDINGS_MODEL=Qwen/Qwen3-Embedding-0.6B
BONZI_LOCAL_EMBEDDINGS_DEVICE=auto
BONZI_LOCAL_EMBEDDINGS_DIMENSIONS=1024
BONZI_LOCAL_EMBEDDINGS_BATCH_SIZE=8
BONZI_LOCAL_EMBEDDINGS_TORCH_DTYPE=auto
```

#### Verify the upstream before launching Bonzi

```bash
curl -s http://127.0.0.1:8999/v1/models
bun run embeddings:check
```

The local Python server accepts OpenAI-style embedding requests including `dimensions`, and Bonzi’s proxy will fail early if the configured upstream still returns a mismatched vector length.

#### Switchable local profiles

Two local-only profile files are available:

- `.env.custom-server` — Bonzi-managed proxy + local Python embeddings server on `127.0.0.1:8999`
- `.env.lm-studio` — direct LM Studio embeddings profile using `text-embedding-nomic-embed-text-v1.5`

Switch profiles by copying one over `.env`:

```bash
cp .env.custom-server .env
# or
cp .env.lm-studio .env
```

When using the custom-server profile, start the upstream first:

```bash
./scripts/run-local-embeddings-server.sh
bun run embeddings:check
```

When using the LM Studio profile, make sure LM Studio is already serving on `http://127.0.0.1:1234/v1` before launching Bonzi.

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

## Vision settings

Discord screenshot reading uses `src/main/vision-client.ts`. By default Bonzi delegates image understanding to the local `pi` CLI so it can reuse an existing pi provider/profile. Set these env vars when needed:

```env
BONZI_VISION_USE_PI=1
# BONZI_VISION_PI_COMMAND=/absolute/path/to/pi
# BONZI_VISION_PI_MODEL=openai-codex/gpt-5.5
BONZI_VISION_TIMEOUT_MS=120000
```

Set `BONZI_VISION_USE_PI=0` to use a direct OpenAI-compatible Responses API call instead:

```env
BONZI_VISION_BASE_URL=https://api.openai.com/v1
BONZI_VISION_MODEL=chatgpt-5.5
BONZI_VISION_API_KEY=your-api-key
```

## Supported built-in emotes and action model

Current built-in runtime emotes:

- `wave`
- `happy-bounce`

Current allowlisted desktop actions:

- `report-shell-state`
- `copy-vrm-asset-path`
- `minimize-window`
- `close-window` (confirmation required)
- `open-url` (HTTP/HTTPS only; embedded credentials and invalid URLs rejected)
- `search-web`
- `cua-check-status`
- `discord-snapshot`
- `discord-read-context`
- `discord-read-screenshot`
- `discord-scroll`
- `discord-type-draft`

Action flow remains: runtime proposes action metadata → main process validates/normalizes → renderer shows action chip or workflow step → user confirms where required → main executes allowlisted action. Workflow actions can pause in `awaiting_approval` or `awaiting_external_action`, emit status updates, and continue after an action completes.

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

## Safety model

- Assistant output is normalized to a JSON envelope.
- Action proposals are filtered to a strict allowlist.
- Runtime/plugin workflow steps are persisted and can be approved, rejected, cancelled, completed, or failed explicitly.
- `close-window` always requires explicit confirmation before execution.
- Third-party plugin installation requires a confirmation round-trip; installs use the user-data plugin workspace and plugin scripts are disabled by default unless explicitly allowed.
- URL-opening actions only accept safe HTTP/HTTPS URLs.
- Markdown knowledge import is size/type limited and does not persist source file paths in settings.
- No unrestricted shell command execution is exposed in preload/main IPC.

## Testing

- `bun run typecheck` verifies main/preload/renderer TypeScript projects.
- `bun run test:e2e` builds the app and runs Playwright tests in `tests/e2e`.
- `bun run embeddings:check` validates the configured embedding upstream before launching the runtime.

## macOS desktop notes

- Companion window is transparent, frameless, always-on-top, and resizable.
- On macOS, it is configured to be visible across workspaces (including fullscreen spaces) and hides standard traffic-light buttons.
- Standard macOS lifecycle is respected (`window-all-closed` does not quit app on darwin).
