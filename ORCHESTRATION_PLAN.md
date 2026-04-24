# Bonzi Desktop Companion — Orchestration Plan

## Context
- Repo: `/Users/t3rpz/projects/bonzi`
- Existing asset: `7120171664031727876.vrm`
- Goal: build a macOS desktop companion app that renders the VRM character on the desktop and can execute tasks through an LLM-backed assistant.
- Preferred MVP stack: Electron + Vite + TypeScript + Three.js + `@pixiv/three-vrm`, because it is fast to scaffold, macOS-friendly, and supports transparent/always-on-top desktop windows. Tauri is a future optimization option.
- "Pi" interpretation: keep the assistant backend provider-pluggable so it can later point to a Raspberry Pi or local network service; MVP should work locally with env-configured OpenAI-compatible endpoint or mock provider.

## Work Items

### [x] Item 1 — App scaffold and desktop window shell
Goal: Create the Electron/Vite/TypeScript project skeleton with a macOS-friendly transparent, frameless, always-on-top companion window and a renderer entry point.
Done when:
- `package.json` has working scripts for install/dev/build/typecheck or equivalent.
- Electron main/preload/renderer structure exists.
- Running dev opens a transparent companion window with basic UI placeholder.
- The VRM asset is available from the renderer public/static path.
Key files/modules:
- `package.json`, `vite.config.*`, `tsconfig*.json`
- `src/main/*`, `src/preload/*`, `src/renderer/*`
- public/static handling for `7120171664031727876.vrm`
Dependencies: none
Size: large

### [x] Item 2 — VRM renderer and character interaction
Goal: Load and render `7120171664031727876.vrm` in the transparent desktop window using Three.js and VRM tooling, with a simple animation/look-at loop and basic drag/reposition behavior if feasible.
Done when:
- The renderer loads the bundled VRM asset without manual external paths.
- The character displays on a transparent canvas with sane camera/lighting.
- There is at least idle animation or breathing/head movement.
- Errors are visible in the UI/console if VRM loading fails.
Key files/modules:
- `src/renderer` VRM/canvas components/modules
- asset path under public/static
Dependencies: Item 1
Size: large

### [x] Item 3 — Assistant/task execution layer
Goal: Add a lightweight assistant panel/chat or command input and backend IPC layer for LLM calls and task execution, provider-pluggable for OpenAI-compatible APIs or future Raspberry Pi/local server.
Done when:
- Renderer can send a user command to main process over a typed IPC boundary.
- Main process routes commands through an assistant service with at least a mock provider and env-configurable OpenAI-compatible provider.
- Responses appear in the UI.
- Dangerous task execution is gated by explicit allowlisted actions or confirmation placeholders; no unrestricted shell execution by default.
Key files/modules:
- `src/main/assistant*`, `src/main/ipc*`, `src/preload/*`
- `src/renderer` chat/command UI
- `.env.example` or README config notes
Dependencies: Item 1; can integrate after Item 2
Size: large

### [x] Item 4 — Validation, docs, and polish
Goal: Verify the MVP, document setup, and add basic quality gates.
Done when:
- README explains dev setup, VRM asset, LLM provider config, and Pi/local-server extension point.
- Typecheck/build scripts pass or documented blockers are fixed.
- Any app-specific macOS notes are captured.
- Plan checklist is updated with completed items.
Key files/modules:
- `README.md`
- project config/scripts
Dependencies: Items 1-3
Size: small
