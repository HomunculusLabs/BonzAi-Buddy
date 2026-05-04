import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import type {
  HermesAuthCredentialStatus,
  HermesConfigFileStatus,
  HermesConfigSource,
  HermesModelAuthCheckResult,
  HermesModelAuthSettings,
  HermesModelAuthSettingsResponse,
  HermesModelOption,
  HermesProviderOption,
  HermesSettingsOptionSource,
  HermesProfileSummary,
  UpdateHermesModelAuthSettingsRequest
} from '../../shared/contracts/hermes'
import { isRecord } from '../../shared/value-utils'

type RuntimeEnv = Record<string, string>

type ModelValues = {
  model?: string
  provider?: string
  baseUrl?: string
}

type ProfileModelValues = ModelValues & {
  profileName: string
}

type ProviderModelHint = {
  provider: string
  label?: string
  models: string[]
  source: HermesSettingsOptionSource
  detail: string
  configured: boolean
  local?: boolean
  baseUrl?: string
}

type HermesConfigSnapshot = {
  model: ModelValues
  providerHints: ProviderModelHint[]
}

type ProfilePaths = {
  name: string
  homeDir: string
  configPath: string
  envPath: string
  authJsonPath: string
  authDirPath: string
}

type PersistedSettings = {
  schemaVersion?: unknown
  hermes?: unknown
  hermesNative?: unknown
  [key: string]: unknown
}

const SETTINGS_FILE_NAME = 'bonzi-settings.json'
const MAX_STRING_LENGTH = 2_048
const DEFAULT_MODEL = 'anthropic/claude-opus-4.6'
const DEFAULT_PROVIDER = 'auto'

const PROVIDER_AUTH_KEYS: Record<string, string[]> = {
  nous: ['NOUS_API_KEY', 'NOUS_INFERENCE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
  lmstudio: ['LM_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  'openai-codex': [],
  'qwen-oauth': [],
  'google-gemini-cli': [],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  'copilot-acp': [],
  gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  zai: ['GLM_API_KEY', 'ZAI_API_KEY', 'Z_AI_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY', 'KIMI_CODING_API_KEY'],
  'kimi-coding-cn': ['KIMI_CN_API_KEY'],
  stepfun: ['STEPFUN_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-oauth': [],
  'minimax-cn': ['MINIMAX_CN_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  alibaba: ['DASHSCOPE_API_KEY'],
  'alibaba-coding-plan': ['ALIBABA_CODING_PLAN_API_KEY', 'DASHSCOPE_API_KEY'],
  'ollama-cloud': ['OLLAMA_API_KEY'],
  arcee: ['ARCEEAI_API_KEY'],
  gmi: ['GMI_API_KEY'],
  kilocode: ['KILOCODE_API_KEY'],
  'opencode-zen': ['OPENCODE_ZEN_API_KEY'],
  'opencode-go': ['OPENCODE_GO_API_KEY'],
  huggingface: ['HF_TOKEN'],
  hf: ['HF_TOKEN'],
  xai: ['XAI_API_KEY'],
  nvidia: ['NVIDIA_API_KEY'],
  xiaomi: ['XIAOMI_API_KEY'],
  'tencent-tokenhub': ['TOKENHUB_API_KEY'],
  'ai-gateway': ['AI_GATEWAY_API_KEY'],
  bedrock: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE'],
  'azure-foundry': ['AZURE_FOUNDRY_API_KEY'],
  custom: ['OPENAI_API_KEY'],
  ollama: ['OPENAI_API_KEY'],
  vllm: ['OPENAI_API_KEY'],
  llamacpp: ['OPENAI_API_KEY'],
  openai: ['OPENAI_API_KEY']
}

const PROVIDER_BASE_URL_KEYS: Record<string, string[]> = {
  nous: ['NOUS_INFERENCE_BASE_URL', 'NOUS_BASE_URL'],
  openrouter: ['OPENROUTER_BASE_URL'],
  lmstudio: ['LM_BASE_URL', 'OPENAI_BASE_URL'],
  anthropic: ['ANTHROPIC_BASE_URL'],
  'openai-codex': ['CODEX_BASE_URL'],
  'qwen-oauth': ['HERMES_QWEN_BASE_URL'],
  'google-gemini-cli': ['GOOGLE_GEMINI_CLI_BASE_URL'],
  copilot: ['COPILOT_API_BASE_URL'],
  'copilot-acp': ['COPILOT_ACP_BASE_URL'],
  gemini: ['GEMINI_BASE_URL'],
  zai: ['GLM_BASE_URL'],
  'kimi-coding': ['KIMI_BASE_URL'],
  'kimi-coding-cn': ['KIMI_CN_BASE_URL'],
  stepfun: ['STEPFUN_BASE_URL'],
  minimax: ['MINIMAX_BASE_URL'],
  'minimax-cn': ['MINIMAX_CN_BASE_URL'],
  deepseek: ['DEEPSEEK_BASE_URL'],
  alibaba: ['DASHSCOPE_BASE_URL'],
  'alibaba-coding-plan': ['ALIBABA_CODING_PLAN_BASE_URL', 'DASHSCOPE_BASE_URL'],
  'ollama-cloud': ['OLLAMA_BASE_URL'],
  arcee: ['ARCEE_BASE_URL'],
  gmi: ['GMI_BASE_URL'],
  kilocode: ['KILOCODE_BASE_URL'],
  'opencode-zen': ['OPENCODE_ZEN_BASE_URL'],
  'opencode-go': ['OPENCODE_GO_BASE_URL'],
  huggingface: ['HF_BASE_URL'],
  hf: ['HF_BASE_URL'],
  xai: ['XAI_BASE_URL'],
  nvidia: ['NVIDIA_BASE_URL'],
  xiaomi: ['XIAOMI_BASE_URL'],
  'tencent-tokenhub': ['TOKENHUB_BASE_URL'],
  'ai-gateway': ['AI_GATEWAY_BASE_URL'],
  bedrock: ['BEDROCK_BASE_URL'],
  'azure-foundry': ['AZURE_FOUNDRY_BASE_URL'],
  custom: ['OPENAI_BASE_URL'],
  ollama: ['OPENAI_BASE_URL', 'OLLAMA_BASE_URL'],
  vllm: ['OPENAI_BASE_URL'],
  llamacpp: ['OPENAI_BASE_URL'],
  openai: ['OPENAI_BASE_URL']
}

const LOCAL_KEYLESS_PROVIDERS = ['auto', 'lmstudio', 'ollama', 'vllm', 'llamacpp'] as const

const CANONICAL_PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'nous', label: 'Nous Portal' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
  { id: 'xiaomi', label: 'Xiaomi MiMo' },
  { id: 'tencent-tokenhub', label: 'Tencent TokenHub' },
  { id: 'nvidia', label: 'NVIDIA NIM' },
  { id: 'qwen-oauth', label: 'Qwen OAuth (Portal)' },
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'copilot-acp', label: 'GitHub Copilot ACP' },
  { id: 'huggingface', label: 'Hugging Face' },
  { id: 'gemini', label: 'Google AI Studio' },
  { id: 'google-gemini-cli', label: 'Google Gemini (OAuth)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xai', label: 'xAI' },
  { id: 'zai', label: 'Z.AI / GLM' },
  { id: 'kimi-coding', label: 'Kimi / Kimi Coding Plan' },
  { id: 'kimi-coding-cn', label: 'Kimi / Moonshot (China)' },
  { id: 'stepfun', label: 'StepFun Step Plan' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'minimax-oauth', label: 'MiniMax (OAuth)' },
  { id: 'minimax-cn', label: 'MiniMax (China)' },
  { id: 'alibaba', label: 'Alibaba Cloud (DashScope)' },
  { id: 'ollama-cloud', label: 'Ollama Cloud' },
  { id: 'arcee', label: 'Arcee AI' },
  { id: 'gmi', label: 'GMI Cloud' },
  { id: 'kilocode', label: 'Kilo Code' },
  { id: 'opencode-zen', label: 'OpenCode Zen' },
  { id: 'opencode-go', label: 'OpenCode Go' },
  { id: 'bedrock', label: 'AWS Bedrock' },
  { id: 'azure-foundry', label: 'Azure Foundry' },
  { id: 'ai-gateway', label: 'Vercel AI Gateway' }
]

const PROVIDER_ALIASES: Record<string, string> = {
  glm: 'zai',
  'z-ai': 'zai',
  'z.ai': 'zai',
  zhipu: 'zai',
  github: 'copilot',
  'github-copilot': 'copilot',
  'github-models': 'copilot',
  'github-model': 'copilot',
  'github-copilot-acp': 'copilot-acp',
  'copilot-acp-agent': 'copilot-acp',
  google: 'gemini',
  'google-gemini': 'gemini',
  'google-ai-studio': 'gemini',
  kimi: 'kimi-coding',
  moonshot: 'kimi-coding',
  'kimi-cn': 'kimi-coding-cn',
  'moonshot-cn': 'kimi-coding-cn',
  step: 'stepfun',
  'stepfun-coding-plan': 'stepfun',
  'arcee-ai': 'arcee',
  arceeai: 'arcee',
  'gmi-cloud': 'gmi',
  gmicloud: 'gmi',
  'minimax-china': 'minimax-cn',
  minimax_cn: 'minimax-cn',
  'minimax-portal': 'minimax-oauth',
  'minimax-global': 'minimax-oauth',
  minimax_oauth: 'minimax-oauth',
  claude: 'anthropic',
  'claude-code': 'anthropic',
  'deep-seek': 'deepseek',
  opencode: 'opencode-zen',
  zen: 'opencode-zen',
  go: 'opencode-go',
  'opencode-go-sub': 'opencode-go',
  aigateway: 'ai-gateway',
  vercel: 'ai-gateway',
  'vercel-ai-gateway': 'ai-gateway',
  kilo: 'kilocode',
  'kilo-code': 'kilocode',
  'kilo-gateway': 'kilocode',
  dashscope: 'alibaba',
  aliyun: 'alibaba',
  qwen: 'alibaba',
  'alibaba-cloud': 'alibaba',
  'qwen-portal': 'qwen-oauth',
  'gemini-cli': 'google-gemini-cli',
  'gemini-oauth': 'google-gemini-cli',
  hf: 'huggingface',
  'hugging-face': 'huggingface',
  'huggingface-hub': 'huggingface',
  mimo: 'xiaomi',
  'xiaomi-mimo': 'xiaomi',
  tencent: 'tencent-tokenhub',
  tokenhub: 'tencent-tokenhub',
  'tencent-cloud': 'tencent-tokenhub',
  tencentmaas: 'tencent-tokenhub',
  aws: 'bedrock',
  'aws-bedrock': 'bedrock',
  'amazon-bedrock': 'bedrock',
  amazon: 'bedrock',
  grok: 'xai',
  'x-ai': 'xai',
  'x.ai': 'xai',
  nim: 'nvidia',
  'nvidia-nim': 'nvidia'
}

const PROVIDER_LABELS: Record<string, string> = {
  auto: 'Auto (Hermes default)',
  custom: 'Custom endpoint',
  openai: 'OpenAI',
  ollama: 'Ollama',
  vllm: 'vLLM',
  llamacpp: 'llama.cpp',
  ...Object.fromEntries(CANONICAL_PROVIDERS.map((provider) => [provider.id, provider.label]))
}

const MODEL_CATALOG: Record<string, string[]> = {
  auto: [DEFAULT_MODEL],
  openrouter: [
    'moonshotai/kimi-k2.6',
    'anthropic/claude-opus-4.7',
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4.6',
    'qwen/qwen3.6-plus',
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-haiku-4.5',
    'openrouter/elephant-alpha',
    'openrouter/owl-alpha',
    'openai/gpt-5.5',
    'openai/gpt-5.4-mini',
    'xiaomi/mimo-v2.5-pro',
    'xiaomi/mimo-v2.5',
    'tencent/hy3-preview:free',
    'openai/gpt-5.3-codex',
    'google/gemini-3-pro-image-preview',
    'google/gemini-3-flash-preview',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3.1-flash-lite-preview',
    'qwen/qwen3.5-plus-02-15',
    'qwen/qwen3.5-35b-a3b',
    'stepfun/step-3.5-flash',
    'minimax/minimax-m2.7',
    'minimax/minimax-m2.5',
    'minimax/minimax-m2.5:free',
    'z-ai/glm-5.1',
    'z-ai/glm-5v-turbo',
    'z-ai/glm-5-turbo',
    'x-ai/grok-4.20',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'arcee-ai/trinity-large-preview:free',
    'arcee-ai/trinity-large-thinking',
    'openai/gpt-5.5-pro',
    'openai/gpt-5.4-nano'
  ],
  nous: [
    'moonshotai/kimi-k2.6',
    'xiaomi/mimo-v2.5-pro',
    'xiaomi/mimo-v2.5',
    'tencent/hy3-preview',
    'anthropic/claude-opus-4.7',
    'anthropic/claude-opus-4.6',
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-haiku-4.5',
    'openai/gpt-5.5',
    'openai/gpt-5.4-mini',
    'openai/gpt-5.3-codex',
    'google/gemini-3-pro-preview',
    'google/gemini-3-flash-preview',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3.1-flash-lite-preview',
    'qwen/qwen3.5-plus-02-15',
    'qwen/qwen3.5-35b-a3b',
    'stepfun/step-3.5-flash',
    'minimax/minimax-m2.7',
    'minimax/minimax-m2.5',
    'minimax/minimax-m2.5:free',
    'z-ai/glm-5.1',
    'z-ai/glm-5v-turbo',
    'z-ai/glm-5-turbo',
    'x-ai/grok-4.20-beta',
    'nvidia/nemotron-3-super-120b-a12b',
    'arcee-ai/trinity-large-thinking',
    'openai/gpt-5.5-pro',
    'openai/gpt-5.4-nano'
  ],
  openai: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  'openai-codex': ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini'],
  'copilot-acp': ['copilot-acp'],
  copilot: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4.6', 'claude-sonnet-4', 'claude-sonnet-4.5', 'claude-haiku-4.5', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'grok-code-fast-1'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
  'google-gemini-cli': ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview'],
  zai: ['glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-5-turbo', 'glm-4.7', 'glm-4.5', 'glm-4.5-flash'],
  xai: ['grok-4.20-reasoning', 'grok-4.20', 'grok-code-fast-1', 'grok-4.1-fast'],
  nvidia: ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-nano-30b-a3b', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'qwen/qwen3.5-397b-a17b', 'deepseek-ai/deepseek-v3.2', 'moonshotai/kimi-k2.6', 'minimaxai/minimax-m2.5', 'z-ai/glm5', 'openai/gpt-oss-120b'],
  'kimi-coding': ['kimi-k2.6', 'kimi-k2.5', 'kimi-for-coding', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-turbo-preview', 'kimi-k2-0905-preview'],
  'kimi-coding-cn': ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-turbo-preview', 'kimi-k2-0905-preview'],
  stepfun: ['step-3.5-flash', 'step-3.5-flash-2603'],
  minimax: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-M2'],
  'minimax-oauth': ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  'minimax-cn': ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1', 'MiniMax-M2'],
  anthropic: ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  xiaomi: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
  'tencent-tokenhub': ['hy3-preview'],
  arcee: ['trinity-large-thinking', 'trinity-large-preview', 'trinity-mini'],
  gmi: ['zai-org/GLM-5.1-FP8', 'deepseek-ai/DeepSeek-V3.2', 'moonshotai/Kimi-K2.5', 'google/gemini-3.1-flash-lite-preview', 'anthropic/claude-sonnet-4.6', 'openai/gpt-5.4'],
  'opencode-zen': ['kimi-k2.5', 'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'claude-opus-4-6', 'claude-opus-4-5', 'claude-opus-4-1', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-haiku-4-5', 'claude-3-5-haiku', 'gemini-3.1-pro', 'gemini-3-pro', 'gemini-3-flash', 'minimax-m2.7', 'minimax-m2.5', 'minimax-m2.5-free', 'minimax-m2.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'kimi-k2-thinking', 'kimi-k2', 'qwen3-coder', 'big-pickle'],
  'opencode-go': ['kimi-k2.6', 'kimi-k2.5', 'glm-5.1', 'glm-5', 'mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'minimax-m2.7', 'minimax-m2.5', 'qwen3.6-plus', 'qwen3.5-plus'],
  kilocode: ['anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.6', 'openai/gpt-5.4', 'google/gemini-3-pro-preview', 'google/gemini-3-flash-preview'],
  alibaba: ['qwen3.6-plus', 'kimi-k2.5', 'qwen3.5-plus', 'qwen3-coder-plus', 'qwen3-coder-next', 'glm-5', 'glm-4.7', 'MiniMax-M2.5'],
  huggingface: ['moonshotai/Kimi-K2.5', 'Qwen/Qwen3.5-397B-A17B', 'Qwen/Qwen3.5-35B-A3B', 'deepseek-ai/DeepSeek-V3.2', 'MiniMaxAI/MiniMax-M2.5', 'zai-org/GLM-5', 'XiaomiMiMo/MiMo-V2-Flash', 'moonshotai/Kimi-K2-Thinking', 'moonshotai/Kimi-K2.6'],
  hf: ['moonshotai/Kimi-K2.5', 'Qwen/Qwen3.5-397B-A17B', 'Qwen/Qwen3.5-35B-A3B', 'deepseek-ai/DeepSeek-V3.2', 'MiniMaxAI/MiniMax-M2.5', 'zai-org/GLM-5', 'XiaomiMiMo/MiMo-V2-Flash', 'moonshotai/Kimi-K2-Thinking', 'moonshotai/Kimi-K2.6'],
  bedrock: ['us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-6-v1', 'us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.amazon.nova-pro-v1:0', 'us.amazon.nova-lite-v1:0', 'us.amazon.nova-micro-v1:0', 'deepseek.v3.2', 'us.meta.llama4-maverick-17b-instruct-v1:0', 'us.meta.llama4-scout-17b-instruct-v1:0'],
  'azure-foundry': [],
  'ai-gateway': ['moonshotai/kimi-k2.6', 'alibaba/qwen3.6-plus', 'zai/glm-5.1', 'minimax/minimax-m2.7', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.7', 'anthropic/claude-opus-4.6', 'anthropic/claude-haiku-4.5', 'openai/gpt-5.4', 'openai/gpt-5.4-mini', 'openai/gpt-5.3-codex', 'google/gemini-3.1-pro-preview', 'google/gemini-3-flash', 'google/gemini-3.1-flash-lite-preview', 'xai/grok-4.20-reasoning'],
  lmstudio: ['local-model'],
  ollama: ['llama3.2', 'qwen2.5-coder:7b', 'mistral'],
  vllm: ['local-model', 'Qwen/Qwen2.5-Coder-7B-Instruct'],
  llamacpp: ['local-model', 'llama-3.1-8b-instruct'],
  custom: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1', 'local-model']
}


export function getHermesModelAuthSettingsResponse(env: RuntimeEnv = loadRuntimeEnv()): HermesModelAuthSettingsResponse {
  return { settings: resolveHermesModelAuthSettings(env) }
}

export function updateHermesModelAuthSettings(
  request: UpdateHermesModelAuthSettingsRequest,
  env: RuntimeEnv = loadRuntimeEnv()
): HermesModelAuthSettingsResponse {
  if (!isRecord(request) || Array.isArray(request)) {
    throw new Error('Hermes model/auth settings update must be an object.')
  }

  const current = resolveHermesModelAuthSettings(env)
  const activeProfile = normalizeProfileName(request.activeProfile) ?? current.activeProfile.name
  const profile = getProfilePaths(activeProfile, env)
  const updates: ModelValues = {}

  if ('model' in request) {
    updates.model = normalizeOptionalString(request.model, MAX_STRING_LENGTH)
  }
  if ('provider' in request) {
    updates.provider = normalizeOptionalString(request.provider, MAX_STRING_LENGTH)
  }
  if ('baseUrl' in request) {
    updates.baseUrl = normalizeOptionalString(request.baseUrl, MAX_STRING_LENGTH)
  }

  if (Object.keys(updates).length > 0) {
    patchHermesConfig(profile.configPath, updates)
  }
  writeBonziNativeOverlay({ activeProfile })

  return getHermesModelAuthSettingsResponse(env)
}

export function checkHermesModelAuthStatus(env: RuntimeEnv = loadRuntimeEnv()): HermesModelAuthCheckResult {
  const settings = resolveHermesModelAuthSettings(env)
  return {
    ok: settings.auth.configured || settings.provider === DEFAULT_PROVIDER,
    message: settings.auth.configured
      ? `Hermes auth looks configured for ${settings.provider}.`
      : settings.provider === DEFAULT_PROVIDER
        ? 'Hermes provider is auto; configure at least one credential source before chat.'
        : `Hermes auth appears missing for ${settings.provider}.`,
    settings
  }
}

export function resolveHermesModelAuthSettings(env: RuntimeEnv = loadRuntimeEnv()): HermesModelAuthSettings {
  const overlayProfile = readBonziNativeOverlayProfile()
  const envProfile = normalizeProfileName(env.BONZI_HERMES_PROFILE) ?? normalizeProfileName(env.HERMES_PROFILE)
  const activeName = envProfile ?? overlayProfile ?? 'default'
  const profile = getProfilePaths(activeName, env)
  const configSnapshot = readConfigSnapshot(profile.configPath, 'hermes-config', 'Configured in the active Hermes profile.')
  const config = configSnapshot.model
  const hermesEnv = loadDotEnv(profile.envPath)
  const mergedEnv = { ...hermesEnv, ...env }

  const provider = resolveProvider(config, hermesEnv, env)
  const model = resolveModel(config, hermesEnv, env)
  let baseUrl = resolveBaseUrl(provider.value, config, hermesEnv, env)
  if (!baseUrl.value) {
    const hintedBaseUrl = findProviderHintBaseUrl(configSnapshot.providerHints, provider.value ?? DEFAULT_PROVIDER)
    if (hintedBaseUrl) {
      baseUrl = { value: hintedBaseUrl, source: 'hermes-config' }
    }
  }
  const auth = resolveAuthStatus(provider.value ?? DEFAULT_PROVIDER, profile, mergedEnv, hermesEnv, env)
  const profiles = ensureActiveProfile(discoverProfiles(env), activeName, profile.homeDir)
  const profileModelValues = readProfileModelValues(profiles, env)
  const providerOptions = buildProviderOptions({
    currentProvider: provider.value ?? DEFAULT_PROVIDER,
    currentSource: provider.source,
    auth,
    activeProfile: profile,
    hermesEnv,
    processEnv: env,
    profileModelValues,
    providerModelHints: configSnapshot.providerHints
  })
  const providerModelHints = [...configSnapshot.providerHints, ...buildProfileProviderModelHints(profiles, env)]
  const modelCatalog = buildModelCatalog(providerOptions, profileModelValues, providerModelHints)
  const modelOptions = buildModelOptions(provider.value ?? DEFAULT_PROVIDER, model.value ?? DEFAULT_MODEL, model.source, profileModelValues, providerModelHints)

  return {
    provider: provider.value ?? DEFAULT_PROVIDER,
    model: model.value ?? DEFAULT_MODEL,
    ...(baseUrl.value ? { baseUrl: baseUrl.value } : {}),
    activeProfile: {
      name: activeName,
      path: profile.homeDir,
      active: true,
      source: envProfile ? 'process-env' : overlayProfile ? 'bonzi-overlay' : 'default'
    },
    profiles,
    hermesHome: getHermesBaseHome(env),
    paths: {
      configPath: profile.configPath,
      envPath: profile.envPath,
      authJsonPath: profile.authJsonPath
    },
    sources: {
      provider: provider.source,
      model: model.source,
      baseUrl: baseUrl.source
    },
    auth,
    providerOptions,
    modelOptions,
    modelCatalog,
    files: {
      config: getFileStatus(profile.configPath),
      env: getFileStatus(profile.envPath),
      authJson: getFileStatus(profile.authJsonPath)
    },
    diagnostics: [
      `Auth status for ${provider.value ?? DEFAULT_PROVIDER}: ${auth.status}.`,
      ...buildOverrideDiagnostics({ provider: provider.source, model: model.source, baseUrl: baseUrl.source }),
      ...auth.diagnostics
    ]
  }
}



function findProviderHintBaseUrl(hints: ProviderModelHint[], provider: string): string | undefined {
  const providerKey = normalizeProviderKey(provider)
  return hints.find((hint) => normalizeProviderKey(hint.provider) === providerKey)?.baseUrl
}

function readProfileModelValues(profiles: HermesProfileSummary[], env: RuntimeEnv): ProfileModelValues[] {
  return profiles.flatMap((profile) => {
    const values = readConfigModelValues(getProfilePaths(profile.name, env).configPath)
    return values.provider || values.model ? [{ ...values, profileName: profile.name }] : []
  })
}

function buildProfileProviderModelHints(profiles: HermesProfileSummary[], env: RuntimeEnv): ProviderModelHint[] {
  return profiles.flatMap((profile) => {
    const snapshot = readConfigSnapshot(
      getProfilePaths(profile.name, env).configPath,
      profile.active ? 'hermes-config' : 'profile-config',
      profile.active ? 'Configured in the active Hermes profile.' : `Configured in Hermes profile ${profile.name}.`
    )
    return snapshot.providerHints
  })
}

type ProviderOptionDraft = Omit<HermesProviderOption, 'sources'> & {
  sources: Set<HermesSettingsOptionSource>
  score: number
}

function buildProviderOptions(options: {
  currentProvider: string
  currentSource: HermesConfigSource
  auth: HermesAuthCredentialStatus
  activeProfile: ProfilePaths
  hermesEnv: RuntimeEnv
  processEnv: RuntimeEnv
  profileModelValues: ProfileModelValues[]
  providerModelHints: ProviderModelHint[]
}): HermesProviderOption[] {
  const drafts = new Map<string, ProviderOptionDraft>()
  const currentProviderKey = normalizeProviderKey(options.currentProvider) ?? DEFAULT_PROVIDER
  const add = (
    provider: string | undefined,
    source: HermesSettingsOptionSource,
    detail: string,
    configured: boolean,
    score: number,
    local = false,
    label?: string
  ): void => {
    const id = normalizeProviderKey(provider)
    if (!id) {
      return
    }
    const existing = drafts.get(id)
    if (existing) {
      existing.sources.add(source)
      existing.configured ||= configured
      existing.current ||= id === currentProviderKey
      existing.local ||= local
      existing.score = Math.max(existing.score, score)
      existing.detail = mergeDetails(existing.detail, detail)
      existing.modelCount = getKnownModelCount(id, options.providerModelHints)
      if (label && existing.label === id) {
        existing.label = label
      }
      return
    }
    drafts.set(id, {
      id,
      label: label ?? PROVIDER_LABELS[id] ?? id,
      configured,
      current: id === currentProviderKey,
      local,
      sources: new Set([source]),
      detail,
      modelCount: getKnownModelCount(id, options.providerModelHints),
      score
    })
  }

  add(options.currentProvider, options.currentSource, 'Current effective Hermes provider.', options.auth.configured, 95)

  for (const hint of options.providerModelHints) {
    add(hint.provider, hint.source, hint.detail, hint.configured, hint.source === 'hermes-config' ? 82 : 58, hint.local ?? false, hint.label)
  }

  for (const profileValues of options.profileModelValues) {
    add(
      profileValues.provider,
      'profile-config',
      `Configured as model.provider in Hermes profile ${profileValues.profileName}.`,
      true,
      profileValues.profileName === options.activeProfile.name ? 78 : 55
    )
  }

  for (const provider of getKnownProviderIds()) {
    const authKeys = PROVIDER_AUTH_KEYS[provider] ?? []
    const envKeys = [...authKeys, ...(PROVIDER_BASE_URL_KEYS[provider] ?? [])]
    for (const key of envKeys) {
      if (normalizeOptionalString(options.processEnv[key], MAX_STRING_LENGTH)) {
        add(provider, 'process-env', `Detected ${key} in the process environment.`, true, 90)
      } else if (normalizeOptionalString(options.hermesEnv[key], MAX_STRING_LENGTH)) {
        add(provider, 'hermes-env', `Detected ${key} in the active Hermes .env.`, true, 88)
      }
    }

    const authHints = findAuthProviderHints(provider, options.activeProfile)
    if (authHints.length > 0) {
      add(provider, 'auth-json', `Detected Hermes auth/credential-pool hint: ${authHints.join(', ')}.`, true, 86)
    }
  }

  for (const provider of CANONICAL_PROVIDERS) {
    add(provider.id, 'canonical', 'Canonical Hermes provider.', false, 20, false, provider.label)
  }

  for (const provider of LOCAL_KEYLESS_PROVIDERS) {
    const id = provider.toString()
    const isCurrent = id === currentProviderKey
    const hasBaseUrl = providerHasBaseUrl(id, options.hermesEnv, options.processEnv)
    if (id === 'auto' || isCurrent || hasBaseUrl) {
      add(id, 'local-default', id === 'auto' ? 'Hermes can auto-select from configured providers.' : 'Local/keyless provider signal.', true, id === 'auto' ? 60 : 62, true)
    }
  }

  return Array.from(drafts.values())
    .map((draft) => ({
      id: draft.id,
      label: draft.label,
      configured: draft.configured,
      current: draft.current,
      local: draft.local,
      sources: Array.from(draft.sources),
      detail: draft.detail,
      modelCount: draft.modelCount
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.configured) - Number(a.configured) || getProviderScore(b) - getProviderScore(a) || a.label.localeCompare(b.label))
}

function buildModelCatalog(
  providerOptions: HermesProviderOption[],
  profileModelValues: ProfileModelValues[],
  providerModelHints: ProviderModelHint[]
): Record<string, HermesModelOption[]> {
  const providers = new Set<string>([
    ...Object.keys(MODEL_CATALOG),
    ...providerOptions.map((option) => option.id),
    ...providerModelHints.map((hint) => normalizeProviderKey(hint.provider)).filter((provider): provider is string => Boolean(provider)),
    'custom'
  ])
  return Object.fromEntries(Array.from(providers).sort().map((provider) => [provider, buildModelOptions(provider, undefined, 'catalog', profileModelValues, providerModelHints)]))
}

function buildModelOptions(
  provider: string,
  currentModel: string | undefined,
  currentSource: HermesSettingsOptionSource,
  profileModelValues: ProfileModelValues[],
  providerModelHints: ProviderModelHint[]
): HermesModelOption[] {
  const providerKey = normalizeProviderKey(provider) ?? provider
  const drafts = new Map<string, HermesModelOption>()
  const add = (model: string | undefined, source: HermesSettingsOptionSource, detail?: string, current = false): void => {
    const id = normalizeOptionalString(model, MAX_STRING_LENGTH)
    if (!id || drafts.has(id)) {
      return
    }
    drafts.set(id, {
      id,
      label: id,
      provider: providerKey,
      current,
      source,
      ...(detail ? { detail } : {})
    })
  }

  add(currentModel, currentSource, 'Current configured Hermes model.', true)

  for (const hint of providerModelHints) {
    if (normalizeProviderKey(hint.provider) === providerKey) {
      for (const model of hint.models) {
        add(model, hint.source, hint.detail)
      }
    }
  }

  for (const model of MODEL_CATALOG[providerKey] ?? MODEL_CATALOG.custom) {
    add(model, 'catalog', `Curated Hermes suggestion for ${PROVIDER_LABELS[providerKey] ?? providerKey}.`)
  }

  for (const profileValues of profileModelValues) {
    if (normalizeProviderKey(profileValues.provider) === providerKey || (!profileValues.provider && providerKey === 'auto')) {
      add(profileValues.model, 'profile-config', `Configured in Hermes profile ${profileValues.profileName}.`)
    }
  }

  return Array.from(drafts.values()).sort((a, b) => Number(b.current) - Number(a.current) || modelSourceRank(a.source) - modelSourceRank(b.source) || a.label.localeCompare(b.label))
}

function getKnownProviderIds(): string[] {
  return Array.from(new Set([
    DEFAULT_PROVIDER,
    ...CANONICAL_PROVIDERS.map((provider) => provider.id),
    ...Object.keys(PROVIDER_AUTH_KEYS),
    ...Object.keys(PROVIDER_BASE_URL_KEYS),
    ...Object.keys(MODEL_CATALOG)
  ])).sort()
}

function getKnownModelCount(provider: string, hints: ProviderModelHint[] = []): number {
  const hintedCount = hints
    .filter((hint) => normalizeProviderKey(hint.provider) === provider)
    .reduce((count, hint) => count + hint.models.length, 0)
  return Math.max((MODEL_CATALOG[provider] ?? MODEL_CATALOG.custom).length, hintedCount)
}

function providerHasBaseUrl(provider: string, hermesEnv: RuntimeEnv, processEnv: RuntimeEnv): boolean {
  return (PROVIDER_BASE_URL_KEYS[provider] ?? []).some((key) =>
    Boolean(normalizeOptionalString(processEnv[key], MAX_STRING_LENGTH) ?? normalizeOptionalString(hermesEnv[key], MAX_STRING_LENGTH))
  )
}

function getProviderScore(option: HermesProviderOption): number {
  if (option.sources.includes('process-env')) return 90
  if (option.sources.includes('hermes-env')) return 88
  if (option.sources.includes('auth-json')) return 86
  if (option.sources.includes('hermes-config')) return 82
  if (option.sources.includes('user-config')) return 80
  if (option.sources.includes('profile-config')) return 60
  if (option.sources.includes('local-default')) return 50
  if (option.sources.includes('canonical')) return 20
  return 0
}

function modelSourceRank(source: HermesSettingsOptionSource): number {
  if (source === 'current') return 0
  if (source === 'hermes-config' || source === 'user-config') return 1
  if (source === 'profile-config') return 2
  if (source === 'catalog') return 3
  return 4
}

function mergeDetails(existing: string, next: string): string {
  return existing.includes(next) ? existing : `${existing} ${next}`
}

function resolveProvider(config: ModelValues, hermesEnv: RuntimeEnv, env: RuntimeEnv): { value?: string; source: HermesConfigSource } {
  return firstResolved([
    [normalizeOptionalString(env.BONZI_HERMES_PROVIDER, MAX_STRING_LENGTH), 'bonzi-env'],
    [normalizeOptionalString(env.HERMES_INFERENCE_PROVIDER, MAX_STRING_LENGTH), 'process-env'],
    [config.provider, 'hermes-config'],
    [normalizeOptionalString(hermesEnv.HERMES_INFERENCE_PROVIDER, MAX_STRING_LENGTH), 'hermes-env']
  ]) ?? { value: DEFAULT_PROVIDER, source: 'default' }
}

function resolveModel(config: ModelValues, hermesEnv: RuntimeEnv, env: RuntimeEnv): { value?: string; source: HermesConfigSource } {
  return firstResolved([
    [normalizeOptionalString(env.BONZI_HERMES_MODEL, MAX_STRING_LENGTH), 'bonzi-env'],
    [normalizeOptionalString(env.HERMES_INFERENCE_MODEL, MAX_STRING_LENGTH), 'process-env'],
    [config.model, 'hermes-config'],
    [normalizeOptionalString(hermesEnv.HERMES_INFERENCE_MODEL, MAX_STRING_LENGTH), 'hermes-env']
  ]) ?? { value: DEFAULT_MODEL, source: 'default' }
}

function resolveBaseUrl(provider: string | undefined, config: ModelValues, hermesEnv: RuntimeEnv, env: RuntimeEnv): { value?: string; source: HermesConfigSource } {
  const providerKey = normalizeProviderKey(provider)
  const providerKeys = providerKey ? PROVIDER_BASE_URL_KEYS[providerKey] ?? [] : []
  const keys = ['BONZI_HERMES_BASE_URL', ...providerKeys, 'OPENAI_BASE_URL']
  const values: Array<[string | undefined, HermesConfigSource]> = []

  for (const key of keys) {
    const value = normalizeOptionalString(env[key], MAX_STRING_LENGTH)
    if (value) {
      values.push([value, key === 'BONZI_HERMES_BASE_URL' ? 'bonzi-env' : 'process-env'])
    }
  }
  values.push([config.baseUrl, 'hermes-config'])
  for (const key of keys.filter((key) => key !== 'BONZI_HERMES_BASE_URL')) {
    const value = normalizeOptionalString(hermesEnv[key], MAX_STRING_LENGTH)
    if (value) {
      values.push([value, 'hermes-env'])
    }
  }

  return firstResolved(values) ?? { source: 'missing' }
}

function resolveAuthStatus(
  provider: string,
  profile: ProfilePaths,
  mergedEnv: RuntimeEnv,
  hermesEnv: RuntimeEnv,
  processEnv: RuntimeEnv
): HermesAuthCredentialStatus {
  const providerKey = normalizeProviderKey(provider) ?? provider
  const requiredEnvKeys = PROVIDER_AUTH_KEYS[providerKey] ?? []
  const configuredEnvKeys = requiredEnvKeys.flatMap((key) => {
    const value = normalizeOptionalString(mergedEnv[key], MAX_STRING_LENGTH)
    if (!value) {
      return []
    }
    const source: HermesConfigSource = processEnv[key]?.trim() ? 'process-env' : hermesEnv[key]?.trim() ? 'hermes-env' : 'missing'
    return [{ key, source, maskedValue: maskSecret(value) }]
  })
  const oauthCredentials = findOAuthCredentials(providerKey, profile)
  const keylessProvider = ['auto', 'lmstudio', 'ollama', 'vllm', 'llamacpp'].includes(providerKey)
  const configured = configuredEnvKeys.length > 0 || oauthCredentials.length > 0 || keylessProvider
  const diagnostics: string[] = []

  if (!configured && requiredEnvKeys.length > 0) {
    diagnostics.push(`Missing ${requiredEnvKeys.join(' or ')} in the active Hermes .env or process environment.`)
  } else if (!configured) {
    diagnostics.push('No matching OAuth credential file was found. Run hermes model/auth for this provider if authentication is required.')
  } else if (keylessProvider && configuredEnvKeys.length === 0 && oauthCredentials.length === 0) {
    diagnostics.push(`${provider} can run without an API key or uses Hermes-managed interactive auth.`)
  }

  return {
    configured,
    status: configured ? 'configured' : 'missing',
    source: configuredEnvKeys[0]?.source ?? (oauthCredentials.length > 0 ? 'auth-json' : keylessProvider ? 'default' : 'missing'),
    requiredEnvKeys,
    configuredEnvKeys,
    oauthCredentials,
    diagnostics
  }
}

function findAuthProviderHints(providerKey: string, profile: ProfilePaths): string[] {
  const hints: string[] = []
  const authStoreHints = readAuthStoreProviderHints(profile.authJsonPath, providerKey)
  if (authStoreHints.length > 0) {
    hints.push(...authStoreHints.map((hint) => `auth store ${hint}`))
  } else if (fileHasProviderHint(profile.authJsonPath, providerKey)) {
    hints.push('auth store hint')
  }

  if (existsSync(profile.authDirPath)) {
    try {
      for (const entry of readdirSync(profile.authDirPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue
        }
        const path = join(profile.authDirPath, entry.name)
        if (entry.name.toLowerCase().includes(providerKey) || fileHasProviderHint(path, providerKey)) {
          hints.push('auth credential file')
        }
      }
    } catch {
      // Best-effort auth directory discovery.
    }
  }
  return Array.from(new Set(hints))
}

function readAuthStoreProviderHints(path: string, providerKey: string): string[] {
  if (!existsSync(path)) {
    return []
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) {
      return []
    }
    const hints: string[] = []
    if (normalizeProviderKey(typeof parsed.active_provider === 'string' ? parsed.active_provider : undefined) === providerKey) {
      hints.push('active_provider')
    }
    for (const key of ['providers', 'credential_pool']) {
      const section = parsed[key]
      if (isRecord(section) && Object.keys(section).some((entry) => normalizeProviderKey(entry) === providerKey)) {
        hints.push(key)
      }
    }
    return hints
  } catch {
    return []
  }
}

function findOAuthCredentials(providerKey: string, profile: ProfilePaths): string[] {
  const paths: string[] = []
  if (readAuthStoreProviderHints(profile.authJsonPath, providerKey).length > 0 || fileHasProviderHint(profile.authJsonPath, providerKey)) {
    paths.push(maskPath(profile.authJsonPath))
  }
  if (existsSync(profile.authDirPath)) {
    try {
      for (const entry of readdirSync(profile.authDirPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue
        }
        const path = join(profile.authDirPath, entry.name)
        if (entry.name.toLowerCase().includes(providerKey) || fileHasProviderHint(path, providerKey)) {
          paths.push(maskPath(path))
        }
      }
    } catch {
      // Best-effort auth directory discovery.
    }
  }
  return Array.from(new Set(paths))
}

function fileHasProviderHint(path: string, providerKey: string): boolean {
  if (!existsSync(path)) {
    return false
  }
  try {
    const raw = readFileSync(path, 'utf8').toLowerCase()
    return raw.trim().length > 0 && (raw.includes(providerKey) || raw.includes(providerKey.replace(/-/gu, '_')))
  } catch {
    return false
  }
}

function discoverProfiles(env: RuntimeEnv): HermesProfileSummary[] {
  const baseHome = getHermesBaseHome(env)
  const profiles: HermesProfileSummary[] = [{ name: 'default', path: baseHome, active: false, source: 'default' }]
  const profilesDir = join(baseHome, 'profiles')
  if (existsSync(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          profiles.push({ name: entry.name, path: join(profilesDir, entry.name), active: false, source: 'profile' })
        }
      }
    } catch {
      // Best-effort profile inventory.
    }
  }
  return profiles
}

function ensureActiveProfile(profiles: HermesProfileSummary[], activeName: string, activePath: string): HermesProfileSummary[] {
  const all = profiles.some((profile) => profile.name === activeName)
    ? profiles
    : [...profiles, { name: activeName, path: activePath, active: false, source: 'bonzi-overlay' as const }]
  return all.map((profile) => ({ ...profile, active: profile.name === activeName }))
}

function getProfilePaths(profileName: string, env: RuntimeEnv): ProfilePaths {
  const baseHome = getHermesBaseHome(env)
  const name = normalizeProfileName(profileName) ?? 'default'
  const homeDir = name === 'default' ? baseHome : join(baseHome, 'profiles', name)
  assertPathWithin(baseHome, homeDir)
  return {
    name,
    homeDir,
    configPath: join(homeDir, 'config.yaml'),
    envPath: join(homeDir, '.env'),
    authJsonPath: join(homeDir, 'auth.json'),
    authDirPath: join(homeDir, 'auth')
  }
}

function getHermesBaseHome(env: RuntimeEnv): string {
  return normalizeOptionalString(env.BONZI_HERMES_HOME, MAX_STRING_LENGTH) ??
    normalizeOptionalString(env.HERMES_HOME, MAX_STRING_LENGTH) ??
    join(homedir(), '.hermes')
}

function readConfigModelValues(path: string): ModelValues {
  return readConfigSnapshot(path, 'profile-config', 'Configured in a Hermes profile.').model
}

function readConfigSnapshot(path: string, source: HermesSettingsOptionSource, detail: string): HermesConfigSnapshot {
  if (!existsSync(path)) {
    return { model: {}, providerHints: [] }
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const model = parseModelSection(raw)
    return {
      model,
      providerHints: buildConfigProviderHints(raw, model, source, detail)
    }
  } catch {
    return { model: {}, providerHints: [] }
  }
}

function parseModelSection(raw: string): ModelValues {
  const lines = raw.split(/\r?\n/u)
  const block = findModelBlock(lines)
  if (!block) {
    return {}
  }
  if (block.inlineValue) {
    return { model: unquoteYamlScalar(block.inlineValue) }
  }

  const values: ModelValues = {}
  for (let index = block.start + 1; index < block.end; index += 1) {
    const match = lines[index].match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/u)
    if (!match) {
      continue
    }
    const key = match[1]
    const value = unquoteYamlScalar(stripYamlComment(match[2]))
    if (!value) {
      continue
    }
    if (key === 'default' || key === 'model') {
      values.model = value
    } else if (key === 'provider') {
      values.provider = value
    } else if (key === 'base_url' || key === 'baseUrl') {
      values.baseUrl = value
    }
  }
  return values
}

function buildConfigProviderHints(
  raw: string,
  model: ModelValues,
  source: HermesSettingsOptionSource,
  detail: string
): ProviderModelHint[] {
  const hints: ProviderModelHint[] = []
  const addHint = (hint: ProviderModelHint): void => {
    const provider = normalizeProviderKey(hint.provider)
    if (!provider) {
      return
    }
    const models = uniqueStrings(hint.models)
    const existing = hints.find((entry) => normalizeProviderKey(entry.provider) === provider && normalizeOptionalString(entry.baseUrl, MAX_STRING_LENGTH) === normalizeOptionalString(hint.baseUrl, MAX_STRING_LENGTH))
    if (existing) {
      existing.models = uniqueStrings([...existing.models, ...models])
      existing.detail = mergeDetails(existing.detail, hint.detail)
      existing.configured ||= hint.configured
      return
    }
    hints.push({ ...hint, provider, models })
  }

  if (model.provider || model.model) {
    addHint({
      provider: model.provider ?? DEFAULT_PROVIDER,
      models: model.model ? [model.model] : [],
      source,
      detail: `${detail} model.provider/default.`,
      configured: true,
      ...(model.baseUrl ? { baseUrl: model.baseUrl } : {})
    })
  }

  for (const provider of parseProvidersSection(raw)) {
    addHint({
      provider: provider.slug,
      label: provider.label,
      models: provider.models,
      source: 'user-config',
      detail: `User-defined providers.${provider.slug} in config.yaml.`,
      configured: true,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {})
    })
  }

  for (const provider of parseCustomProviderGroups(raw, model.provider, model.baseUrl)) {
    addHint({
      provider: provider.slug,
      label: provider.label,
      models: provider.models,
      source: 'user-config',
      detail: `Grouped custom_providers endpoint ${provider.label}.`,
      configured: true,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {})
    })
  }

  return hints
}

type ParsedProviderConfig = {
  slug: string
  label?: string
  baseUrl?: string
  models: string[]
}

function parseProvidersSection(raw: string): ParsedProviderConfig[] {
  const lines = raw.split(/\r?\n/u)
  const block = findTopLevelBlock(lines, 'providers')
  if (!block) {
    return []
  }
  const providers: ParsedProviderConfig[] = []
  let currentSlug = ''
  let currentLines: string[] = []
  const flush = (): void => {
    if (!currentSlug) {
      return
    }
    const label = extractScalarFromLines(currentLines, ['name', 'display_name', 'label']) ?? currentSlug
    const baseUrl = extractScalarFromLines(currentLines, ['base_url', 'baseUrl', 'api', 'url'])
    const defaultModel = extractScalarFromLines(currentLines, ['default_model', 'model'])
    providers.push({
      slug: currentSlug,
      label,
      ...(baseUrl ? { baseUrl } : {}),
      models: uniqueStrings([...(defaultModel ? [defaultModel] : []), ...extractModelsFromLines(currentLines)])
    })
  }

  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index]
    const entry = line.match(/^\s{2}([^\s].*?):\s*(?:#.*)?$/u)
    if (entry) {
      flush()
      currentSlug = unquoteYamlScalar(stripYamlComment(entry[1])) ?? ''
      currentLines = []
      continue
    }
    if (currentSlug) {
      currentLines.push(line)
    }
  }
  flush()
  return providers.filter((provider) => Boolean(provider.slug))
}

function parseCustomProviderGroups(raw: string, currentProvider?: string, currentBaseUrl?: string): ParsedProviderConfig[] {
  const lines = raw.split(/\r?\n/u)
  const block = findTopLevelBlock(lines, 'custom_providers')
  if (!block) {
    return []
  }
  const entries: ParsedProviderConfig[] = []
  let currentLines: string[] = []
  const flush = (): void => {
    if (currentLines.length === 0) {
      return
    }
    const rawName = extractScalarFromLines(currentLines, ['name'])
    const baseUrl = extractScalarFromLines(currentLines, ['base_url', 'baseUrl', 'api', 'url'])
    if (!rawName || !baseUrl) {
      currentLines = []
      return
    }
    const label = cleanCustomProviderDisplayName(rawName)
    const providerSlug = currentBaseUrl && stripTrailingSlash(baseUrl) === stripTrailingSlash(currentBaseUrl) && currentProvider && currentProvider !== 'custom'
      ? currentProvider
      : customProviderSlug(label)
    const defaultModel = extractScalarFromLines(currentLines, ['model', 'default_model'])
    entries.push({
      slug: providerSlug,
      label,
      baseUrl,
      models: uniqueStrings([...(defaultModel ? [defaultModel] : []), ...extractModelsFromLines(currentLines)])
    })
    currentLines = []
  }

  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index]
    const item = line.match(/^\s{2}-\s*(.*)$/u)
    if (item) {
      flush()
      currentLines = []
      if (item[1].trim()) {
        currentLines.push(`    ${item[1].trim()}`)
      }
      continue
    }
    if (currentLines.length > 0 || /^\s{4}\S/u.test(line)) {
      currentLines.push(line)
    }
  }
  flush()

  const groups = new Map<string, ParsedProviderConfig>()
  for (const entry of entries) {
    const key = `${stripTrailingSlash(entry.baseUrl ?? '')}\u0000${entry.label ?? entry.slug}`.toLowerCase()
    const existing = groups.get(key)
    if (existing) {
      existing.models = uniqueStrings([...existing.models, ...entry.models])
    } else {
      groups.set(key, { ...entry })
    }
  }
  return Array.from(groups.values())
}

function findTopLevelBlock(lines: string[], key: string): { start: number; end: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`^${escapeRegExp(key)}:\\s*(?:#.*)?$`, 'u').test(lines[index])) {
      continue
    }
    let end = index + 1
    while (end < lines.length) {
      if (lines[end].trim() && !/^\s/u.test(lines[end])) {
        break
      }
      end += 1
    }
    return { start: index, end }
  }
  return null
}

function extractScalarFromLines(lines: string[], keys: string[]): string | undefined {
  const keyPattern = keys.map(escapeRegExp).join('|')
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*(?:${keyPattern}):\\s*(.*?)\\s*$`, 'u'))
    if (!match) {
      continue
    }
    const value = unquoteYamlScalar(stripYamlComment(match[1]))
    if (value) {
      return value
    }
  }
  return undefined
}

function extractModelsFromLines(lines: string[]): string[] {
  const models: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)models:\s*(.*?)\s*$/u)
    if (!match) {
      continue
    }
    const indent = match[1].length
    const inlineValue = stripYamlComment(match[2])
    if (inlineValue) {
      models.push(...parseInlineYamlList(inlineValue))
      continue
    }
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child]
      if (line.trim() && leadingWhitespace(line) <= indent) {
        break
      }
      const listItem = line.match(/^\s*-\s*(.*?)\s*$/u)
      if (listItem) {
        const listValue = listItem[1]
        const named = listValue.match(/^name:\s*(.*?)\s*$/u)
        const value = unquoteYamlScalar(stripYamlComment(named ? named[1] : listValue))
        if (value) {
          models.push(value)
        }
        continue
      }
      const dictKey = line.match(/^\s*([^\s].*?):\s*(?:\{.*\}|\[.*\]|.*?)\s*$/u)
      if (dictKey) {
        const value = unquoteYamlScalar(stripYamlComment(dictKey[1]))
        if (value && !['name', 'context_length', 'max_tokens'].includes(value)) {
          models.push(value)
        }
      }
    }
  }
  return uniqueStrings(models)
}

function parseInlineYamlList(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    const scalar = unquoteYamlScalar(trimmed)
    return scalar ? [scalar] : []
  }
  return trimmed.slice(1, -1).split(',').flatMap((item) => {
    const scalar = unquoteYamlScalar(stripYamlComment(item.trim()))
    return scalar ? [scalar] : []
  })
}

function customProviderSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return slug ? `custom:${slug}` : 'custom'
}

function cleanCustomProviderDisplayName(name: string): string {
  for (const separator of ['—', ' - ']) {
    if (name.includes(separator)) {
      const base = name.split(separator)[0]?.trim()
      if (base) {
        return base
      }
    }
  }
  return name.trim()
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/u, '')
}

function leadingWhitespace(value: string): number {
  return value.length - value.trimStart().length
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeOptionalString(value, MAX_STRING_LENGTH)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function patchHermesConfig(path: string, updates: ModelValues): void {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = raw ? raw.split(/\r?\n/u) : []
  const block = findModelBlock(lines)
  const next = {
    ...parseModelSection(raw),
    ...(Object.prototype.hasOwnProperty.call(updates, 'model') ? { model: updates.model } : {}),
    ...(Object.prototype.hasOwnProperty.call(updates, 'provider') ? { provider: updates.provider } : {}),
    ...(Object.prototype.hasOwnProperty.call(updates, 'baseUrl') ? { baseUrl: updates.baseUrl } : {})
  }
  const rendered = renderModelBlock(next, block ? getPreservedModelLines(lines, block) : [])
  const content = block
    ? [...lines.slice(0, block.start), ...rendered.split('\n'), ...lines.slice(block.end)].join('\n')
    : `${raw.trim().length > 0 ? `${raw.replace(/\s*$/u, '')}\n\n` : ''}${rendered}`

  writeAtomicFile(path, `${content.replace(/\s*$/u, '')}\n`)
}

function renderModelBlock(values: ModelValues, preservedLines: string[] = []): string {
  const lines = ['model:']
  if (values.model) {
    lines.push(`  default: ${quoteYamlScalar(values.model)}`)
  }
  if (values.provider) {
    lines.push(`  provider: ${quoteYamlScalar(values.provider)}`)
  }
  if (values.baseUrl) {
    lines.push(`  base_url: ${quoteYamlScalar(values.baseUrl)}`)
  }
  lines.push(...preservedLines)
  if (lines.length === 1) {
    lines.push(`  provider: ${quoteYamlScalar(DEFAULT_PROVIDER)}`)
  }
  return lines.join('\n')
}

function getPreservedModelLines(lines: string[], block: { start: number; end: number }): string[] {
  const replacedOrUnsafeKeys = new Set(['default', 'model', 'provider', 'base_url', 'baseUrl', 'api_key', 'api_mode'])
  const preserved: string[] = []
  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      continue
    }
    const match = line.match(/^\s*([A-Za-z0-9_-]+):/u)
    if (match && replacedOrUnsafeKeys.has(match[1])) {
      continue
    }
    preserved.push(line)
  }
  return preserved
}

function findModelBlock(lines: string[]): { start: number; end: number; inlineValue?: string } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)model:\s*(.*?)\s*$/u)
    if (!match || match[1].length > 0) {
      continue
    }
    const inlineValue = stripYamlComment(match[2])
    let end = index + 1
    while (end < lines.length) {
      if (lines[end].trim() && !/^\s/u.test(lines[end])) {
        break
      }
      end += 1
    }
    return { start: index, end, ...(inlineValue ? { inlineValue } : {}) }
  }
  return null
}

function readBonziNativeOverlayProfile(): string | undefined {
  const settings = readSettingsFile()
  const native = isRecord(settings.hermesNative) ? settings.hermesNative : {}
  return normalizeProfileName(native.activeProfile)
}

function writeBonziNativeOverlay(value: { activeProfile: string }): void {
  const path = getSettingsPath()
  const file = readSettingsFile()
  const native = isRecord(file.hermesNative) ? file.hermesNative : {}
  writeAtomicFile(path, JSON.stringify({ ...file, schemaVersion: 2, hermesNative: { ...native, activeProfile: value.activeProfile } }, null, 2))
}

function readSettingsFile(): PersistedSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return { schemaVersion: 2 }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return isRecord(parsed) ? parsed : { schemaVersion: 2 }
  } catch {
    return { schemaVersion: 2 }
  }
}

function getSettingsPath(): string {
  return join(getUserDataDir(), SETTINGS_FILE_NAME)
}

function getUserDataDir(): string {
  if (process.env.BONZI_USER_DATA_DIR?.trim()) {
    return process.env.BONZI_USER_DATA_DIR.trim()
  }

  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
}

function getFileStatus(path: string): HermesConfigFileStatus {
  if (!existsSync(path)) {
    return { path, exists: false, readable: false }
  }
  try {
    const stat = statSync(path)
    if (!stat.isFile()) {
      return { path, exists: true, readable: false, error: 'Path exists but is not a file.' }
    }
    readFileSync(path, 'utf8')
    return { path, exists: true, readable: true }
  } catch (error) {
    return { path, exists: true, readable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function firstResolved(values: Array<[string | undefined, HermesConfigSource]>): { value?: string; source: HermesConfigSource } | undefined {
  for (const [value, source] of values) {
    if (value) {
      return { value, source }
    }
  }
  return undefined
}

function loadRuntimeEnv(): RuntimeEnv {
  const fileEnv = loadDotEnv(join(process.cwd(), '.env'))
  const processEnv = Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : []))
  return { ...fileEnv, ...processEnv }
}

function loadDotEnv(path: string): RuntimeEnv {
  if (!existsSync(path)) {
    return {}
  }
  return readFileSync(path, 'utf8').split(/\r?\n/u).reduce<RuntimeEnv>((env, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return env
    }
    const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const separator = normalized.indexOf('=')
    if (separator <= 0) {
      return env
    }
    env[normalized.slice(0, separator).trim()] = unquoteEnvValue(normalized.slice(separator + 1).trim())
    return env
  }, {})
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function normalizeProfileName(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value, 128)
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized) || normalized.includes('..')) {
    return undefined
  }
  return normalized
}

function normalizeProviderKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized ? PROVIDER_ALIASES[normalized] ?? normalized : undefined
}

function stripYamlComment(value: string): string {
  const hashIndex = value.indexOf('#')
  return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim()
}

function unquoteYamlScalar(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value)
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '••••'
  }
  return '••••••••'
}

function maskPath(path: string): string {
  return path.replace(getHermesBaseHome(loadRuntimeEnv()), '~/.hermes')
}

function buildOverrideDiagnostics(sources: { provider: HermesConfigSource; model: HermesConfigSource; baseUrl: HermesConfigSource }): string[] {
  return (Object.entries(sources) as Array<[string, HermesConfigSource]>).flatMap(([field, source]) =>
    source === 'bonzi-env' || source === 'process-env'
      ? [`Effective ${field} is overridden by ${source}; saving updates the active profile config but will not change the effective value until that environment override is unset.`]
      : []
  )
}

function assertPathWithin(baseDir: string, targetPath: string): void {
  const base = resolve(baseDir)
  const target = resolve(targetPath)
  const rel = relative(base, target)
  if (rel.startsWith('..') || rel === '..' || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('Resolved Hermes profile path escapes the Hermes home directory.')
  }
}

function writeAtomicFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = join(dirname(path), `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
  writeFileSync(tempPath, content)
  renameSync(tempPath, path)
}
