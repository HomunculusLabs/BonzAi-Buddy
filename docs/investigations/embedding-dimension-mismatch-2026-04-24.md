# Investigation: Embedding Dimension Mismatch

## Summary
Investigating why Bonzi fails runtime warmup with LM Studio + Qwen3 Embedding 8B due to `Invalid embedding dimension: 4096. Must be one of: 384, 512, 768, 1024, 1536, 3072`, and whether ElizaOS should allow 4096 in this setup.

## Symptoms
- Bonzi main process warms `BonziRuntimeManager` on startup and fails before normal assistant history hydration.
- Logs first showed unsupported embedding model on the OpenAI-compatible provider, then dimension mismatch after pointing embeddings to LM Studio.
- Current config uses Z.AI for chat/completions and LM Studio OpenAI-compatible `/v1/embeddings` for embeddings.
- LM Studio exposes model `text-embedding-qwen3-embedding-8b`, which appears to return 4096-dimensional vectors by default.

## Background / Prior Research
- **LM Studio’s OpenAI-compatible API supports `/v1/embeddings` and accepts a `dimensions` request field.** LM Studio docs for the OpenAI-compatible endpoint explicitly list `POST /v1/embeddings` and include `dimensions` as a supported request field, with the default local server base URL convention shown as `http://localhost:1234/v1`. Source: https://lmstudio.ai/docs/app/api/endpoints/openai
- **LM Studio is currently serving the local embedding model id `text-embedding-qwen3-embedding-8b`.** Querying the local LM Studio server at `http://127.0.0.1:1234/v1/models` returned that exact model id in the model list alongside other local models.
- **The installed Eliza OpenAI plugin validates requested embedding dimensions against `@elizaos/core`’s `VECTOR_DIMS`, not against provider-reported capabilities.** In the published Bonzi dependency at `node_modules/@elizaos/plugin-openai/dist/node/index.node.js`, `getEmbeddingDimensions(runtime)` reads `OPENAI_EMBEDDING_DIMENSIONS` with a default of `1536`, then `validateDimension()` rejects anything not in `Object.values(VECTOR_DIMS)`, throwing `Invalid embedding dimension: ... Must be one of: ...`.
- **`VECTOR_DIMS` in the local Eliza type definitions does not include 4096.** The local Eliza reference repo defines allowed vector sizes in `packages/typescript/src/types/database.ts` as `384, 512, 768, 1024, 1536, 3072`. That matches the runtime error and explains why 4096 is rejected before Bonzi can use it.
- **Implication:** even if the LM Studio model natively emits 4096-dimensional embeddings, Bonzi’s installed Eliza stack only accepts a requested dimension from the framework allowlist. So the question is not whether the provider can emit 4096, but whether the installed Eliza runtime/plugin/core combination accepts 4096 as a legal vector dimension. Current evidence says no.

## Investigator Findings

1. **Bonzi appears to forward the configured embedding override correctly; I did not find a Bonzi-side rewrite to 4096.**
   - `.env:1,5-8` sets `BONZI_ASSISTANT_PROVIDER=openai-compatible`, `BONZI_OPENAI_EMBEDDING_MODEL=text-embedding-qwen3-embedding-8b`, `BONZI_OPENAI_EMBEDDING_URL=http://127.0.0.1:1234/v1`, and `BONZI_OPENAI_EMBEDDING_DIMENSIONS=1536`.
   - `src/main/eliza/config.ts:141-151` loads `.env` from `join(process.cwd(), '.env')` and merges it with `process.env`, with `process.env` taking precedence if the app is launched with overrides.
   - `src/main/eliza/config.ts:50-60` reads the Bonzi OpenAI embedding env vars, including `BONZI_OPENAI_EMBEDDING_DIMENSIONS`; `src/main/eliza/config.ts:196-210` accepts any positive integer and does **not** clamp or remap `1536` to another allowed size.
   - `src/main/eliza/config.ts:104-110` copies the parsed embedding settings into `config.openai.embedding`.
   - `src/main/eliza/runtime-manager.ts:345-370` forwards those values into the Eliza runtime via `runtime.setSetting(...)`, including `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_URL`, and `OPENAI_EMBEDDING_DIMENSIONS`.
   - I also checked my current probe shell environment: `BONZI_OPENAI_EMBEDDING_DIMENSIONS` and `OPENAI_EMBEDDING_DIMENSIONS` were unset, so I did not see evidence of an external override in this session. That does **not** prove what Electron inherited at app launch, but it weakens the case for a local shell-level override.

2. **The installed/runtime Eliza stack in Bonzi is `2.0.0-alpha.3`, and the primary hard rejection of 4096 is in the installed OpenAI plugin, not in Bonzi config parsing.**
   - Bonzi pins `@elizaos/core`, `@elizaos/plugin-localdb`, and `@elizaos/plugin-openai` to `2.0.0-alpha.3` in `package.json:24-28`.
   - The installed packages confirm that version reality: `node_modules/@elizaos/plugin-openai/package.json:2-3` shows `@elizaos/plugin-openai@2.0.0-alpha.3`, with `@elizaos/core@2.0.0-alpha.3` as a dependency at `node_modules/@elizaos/plugin-openai/package.json:36-39`; `node_modules/@elizaos/core/package.json:2-3` shows `@elizaos/core@2.0.0-alpha.3`.
   - In the installed plugin, `node_modules/@elizaos/plugin-openai/dist/node/index.node.js:112-113` reads `OPENAI_EMBEDDING_DIMENSIONS` with default `1536`.
   - The hard allowlist check is at `node_modules/@elizaos/plugin-openai/dist/node/index.node.js:433-436`: `validateDimension()` compares the requested dimension against `Object.values(VECTOR_DIMS)` and throws `Invalid embedding dimension: ... Must be one of: ...` when the requested value is not allowed.
   - That validation is applied during embedding generation at `node_modules/@elizaos/plugin-openai/dist/node/index.node.js:452-455`.
   - Even when the requested dimension itself is allowed (for example `1536`), the plugin still rejects a provider response whose vector length differs from the requested dimension at `node_modules/@elizaos/plugin-openai/dist/node/index.node.js:489-491` via `Embedding dimension mismatch: got ${embedding.length}, expected ${embeddingDimension}`.
   - The installed core allowlist excludes 4096: `node_modules/@elizaos/core/dist/node/index.node.js:35260-35266` defines `VECTOR_DIMS = { SMALL: 384, MEDIUM: 512, LARGE: 768, XL: 1024, XXL: 1536, XXXL: 3072 }`.

3. **Installed local storage (`plugin-localdb`) does not appear to be the first component rejecting 4096; it is dimension-consistent rather than dimension-allowlisted.**
   - `node_modules/@elizaos/plugin-localdb/dist/node/adapter.js:97-101` implements `ensureEmbeddingDimension(dimension)` by storing the dimension and initializing the vector index with it.
   - `node_modules/@elizaos/plugin-localdb/dist/node/hnsw.js:36-44` reloads a persisted index only when the saved index dimension matches the requested dimension.
   - `node_modules/@elizaos/plugin-localdb/dist/node/hnsw.js:52-55` throws only on **vector/index mismatch** (`expected ${this.dimension}, got ${vector.length}`), not because `4096` itself is forbidden.
   - So the first hard failure mode is: (a) OpenAI plugin rejects requested `4096` as unsupported, or (b) OpenAI plugin requests `1536` but LM Studio still returns `4096`, which then triggers the plugin’s response-length mismatch check before storage becomes the deciding factor.

4. **The local Eliza reference checkout is not version-identical to Bonzi’s installed runtime, but the inspected reference sources still do not show 4096 support.**
   - The loaded reference checkout path is `eliza-v2.0.0-alpha.344`, but its root `package.json:1-3` reports version `2.0.0-alpha.176`, so it is **not** a clean version match for Bonzi’s installed `2.0.0-alpha.3` packages.
   - Even so, the reference type-level allowlist still omits 4096 at `eliza-v2.0.0-alpha.344/packages/typescript/src/types/database.ts:1362-1368` (`384, 512, 768, 1024, 1536, 3072`).
   - The reference runtime also normalizes local embedding dimensions against the same SQL-compatible set at `eliza-v2.0.0-alpha.344/packages/agent/src/runtime/eliza.ts:391-402`, and only writes `LOCAL_EMBEDDING_DIMENSIONS` after that normalization at `eliza-v2.0.0-alpha.344/packages/agent/src/runtime/eliza.ts:460-462`.
   - The reference OpenAI plugin registry entry still advertises default embedding dimensions of `1536` at `eliza-v2.0.0-alpha.344/packages/app-core/src/registry/entries/plugins/openai.json:91-97`.
   - The reference knowledge config reads `OPENAI_EMBEDDING_DIMENSIONS` (or defaults to `1536` for non-local embeddings) at `eliza-v2.0.0-alpha.344/packages/typescript/src/features/knowledge/config.ts:62-67`.
   - Net: although the reference checkout is not the same version as the installed runtime, both the installed code and the inspected reference sources point in the same direction: 4096 is not in the supported Eliza vector-dimension set.

5. **LM Studio at `http://127.0.0.1:1234/v1/embeddings` did not honor a `dimensions: 1536` request for `text-embedding-qwen3-embedding-8b` during this probe.**
   - Live probe on 2026-04-24 against `GET /v1/models` showed `text-embedding-qwen3-embedding-8b` in the served model list.
   - `POST /v1/embeddings` with no `dimensions` field returned an embedding length of **4096**.
   - `POST /v1/embeddings` with `{"model":"text-embedding-qwen3-embedding-8b","input":"Bonzi embedding dimension probe","dimensions":1536}` also returned an embedding length of **4096**.
   - `POST /v1/embeddings` with `dimensions: 4096` returned **4096** as well.
   - The first five floats from the default and `dimensions: 1536` responses were identical in my probe, which is strong evidence that LM Studio ignored the `dimensions` parameter for this loaded model/server state rather than truncating or projecting to 1536.

6. **Bottom line of the hypothesis check:** the evidence supports **both halves** of the narrower hypothesis.
   - Bonzi’s config/runtime handoff appears correct for `1536`.
   - The installed Eliza OpenAI plugin/runtime stack rejects requested `4096` because 4096 is outside `VECTOR_DIMS`.
   - Separately, LM Studio currently returns `4096` even when Bonzi/Eliza requests `1536`, which then triggers the installed plugin’s response-length mismatch check.
   - That makes LM Studio’s current behavior the most likely explanation for a failure path where Bonzi is configured with `BONZI_OPENAI_EMBEDDING_DIMENSIONS=1536` but the runtime still sees a 4096-length embedding.

## Investigation Log

## Root Cause
Bonzi is not miswiring the embedding settings. In `src/main/eliza/config.ts:50-67`, Bonzi reads `BONZI_OPENAI_EMBEDDING_MODEL`, `BONZI_OPENAI_EMBEDDING_URL`, `BONZI_OPENAI_EMBEDDING_API_KEY`, and `BONZI_OPENAI_EMBEDDING_DIMENSIONS`; in `src/main/eliza/runtime-manager.ts:345-372`, it forwards those values into Eliza runtime settings as `OPENAI_EMBEDDING_*`.

The actual failure is split across **installed Eliza constraints** and **provider behavior**:

1. **Installed Eliza/OpenAI plugin reality rejects 4096 as an allowed requested dimension.** Bonzi is pinned to `@elizaos/core@2.0.0-alpha.3` and `@elizaos/plugin-openai@2.0.0-alpha.3`. In the installed OpenAI plugin, `validateDimension()` rejects any requested embedding dimension not present in core `VECTOR_DIMS`, and installed core `VECTOR_DIMS` only includes `384, 512, 768, 1024, 1536, 3072`.
2. **Broader Eliza runtime/schema support also tops out at 3072.** The local Eliza reference sources define only those same six dimensions in `packages/typescript/src/types/database.ts:1362-1368`; the embeddings schema has only `dim_384`, `dim_512`, `dim_768`, `dim_1024`, `dim_1536`, and `dim_3072` columns in `packages/typescript/src/schemas/embedding.ts:4-45`; and `packages/agent/src/runtime/eliza.ts:391-402` explicitly normalizes SQL-compatible embedding dimensions to that same set, defaulting unsupported values away from 4096.
3. **LM Studio is not honoring the requested 1536 output size for this loaded model.** Live probes against `http://127.0.0.1:1234/v1/embeddings` with model `text-embedding-qwen3-embedding-8b` returned vectors of length 4096 both with no `dimensions` field and with `dimensions: 1536`. That means even when Bonzi/Eliza requests 1536, the provider still returns a 4096-length vector.

Therefore, the concrete end-to-end root cause is:
- Bonzi correctly requests a supported Eliza dimension (1536),
- but LM Studio returns 4096 anyway,
- and the installed Eliza OpenAI plugin then fails the embedding-length mismatch check because it expects 1536.

So the user intuition that “ElizaOS allows 4096” is **not true in this Bonzi-installed setup**. There is no evidence in the installed alpha.3 packages or the inspected local Eliza reference sources of stock end-to-end 4096 support.

## Recommendations
1. **Use a real external embeddings server outside LM Studio.** For Bonzi, the best practical recommendation is Hugging Face **Text Embeddings Inference (TEI)** serving `Qwen/Qwen3-Embedding-8B` when hardware permits, or `Qwen/Qwen3-Embedding-0.6B` as the lighter fallback.
2. **Keep Bonzi/Eliza on supported dimensions only.** For the current Bonzi stack that means `384`, `512`, `768`, `1024`, `1536`, or `3072`.
3. **Prefer a server that honors `dimensions`, but add a Matryoshka-safe fallback for Qwen3-class models.** Qwen3 Embedding is an MRL-capable family, so Bonzi can safely support a `matryoshka-truncate` compatibility mode that keeps the first requested dimensions when an upstream ignores the `dimensions` field and returns a larger vector.
4. **Do not chase 4096 as an Eliza config-only fix.** End-to-end native 4096 support would still require coordinated Eliza/framework/schema changes.

## Implemented Resolution

Bonzi now recommends TEI instead of LM Studio for local external embeddings, and the Bonzi-managed embeddings proxy supports an opt-in `BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY=matryoshka-truncate` mode for Matryoshka-trained models such as Qwen3 Embedding. In that mode, if the upstream returns more dimensions than Bonzi requested, Bonzi truncates the embedding to the configured Eliza-compatible size before passing it to Eliza.

## Preventive Measures
- Add a startup diagnostic in Bonzi that probes the configured embeddings endpoint once and logs the actual returned vector length before warming the runtime, so provider-vs-framework mismatches are obvious immediately.
- Document in Bonzi’s embedding configuration docs that valid Eliza dimensions in the current stack are `384, 512, 768, 1024, 1536, 3072`, and that the provider must actually return the requested size.
- When upgrading Eliza dependencies, explicitly re-test embedding dimensions against both the framework allowlist and the provider’s real `/v1/embeddings` behavior instead of assuming OpenAI-compatible servers honor `dimensions` uniformly.
