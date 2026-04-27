import { createCharacter, type Character } from '@elizaos/core/node'
import { formatBonziDesktopActionPromptList } from './bonzi-desktop-actions-plugin'
import type { SanitizedBonziCharacterOverride } from './plugin-settings-model'

export const DEFAULT_BONZI_CHARACTER_NAME = 'Bonzi'
export const DEFAULT_BONZI_CHARACTER_BIO =
  'A desktop companion assistant that chats safely and can suggest a small allowlist of confirmation-aware desktop actions.'

export const DEFAULT_BONZI_SYSTEM_PROMPT = createDefaultBonziSystemPrompt({
  desktopActionsEnabled: true,
  contextEnabled: true,
  approvalsEnabled: true
})

export function createBonziCharacter(options: {
  systemPromptOverride?: string
  desktopActionsEnabled?: boolean
  contextEnabled?: boolean
  approvalsEnabled?: boolean
  characterOverride?: SanitizedBonziCharacterOverride | null
} = {}): Character {
  const runtimePromptOptions = {
    desktopActionsEnabled: options.desktopActionsEnabled !== false,
    contextEnabled: options.contextEnabled !== false,
    approvalsEnabled: options.approvalsEnabled !== false
  }
  const characterOverride = options.characterOverride ?? null
  const baseSystemPrompt =
    options.systemPromptOverride?.trim() ||
    createDefaultBonziSystemPrompt(runtimePromptOptions)
  const systemPrompt = characterOverride?.system
    ? `${characterOverride.system}\n\n${createBonziRuntimeSafetyAppendix(runtimePromptOptions)}`
    : baseSystemPrompt
  const bio = createBonziCharacterBio(characterOverride)

  return createCharacter({
    name: characterOverride?.name ?? DEFAULT_BONZI_CHARACTER_NAME,
    system: systemPrompt,
    bio,
    ...(characterOverride?.messageExamples
      ? { messageExamples: characterOverride.messageExamples }
      : {}),
    ...(characterOverride?.postExamples
      ? { postExamples: characterOverride.postExamples }
      : {}),
    ...(characterOverride?.topics ? { topics: characterOverride.topics } : {}),
    ...(characterOverride?.adjectives
      ? { adjectives: characterOverride.adjectives }
      : {}),
    ...(characterOverride?.style ? { style: characterOverride.style } : {})
  })
}

function createBonziCharacterBio(
  characterOverride: SanitizedBonziCharacterOverride | null
): string | string[] {
  const defaultBio = DEFAULT_BONZI_CHARACTER_BIO
  const overrideBio = characterOverride?.bio
  const lore = characterOverride?.lore ?? []

  if (!overrideBio && lore.length === 0) {
    return defaultBio
  }

  const bioEntries = Array.isArray(overrideBio)
    ? overrideBio
    : overrideBio
      ? [overrideBio]
      : []

  return [...bioEntries, ...lore]
}

function createBonziRuntimeSafetyAppendix(options: {
  desktopActionsEnabled: boolean
  contextEnabled: boolean
  approvalsEnabled: boolean
}): string {
  const actionRule = options.desktopActionsEnabled
    ? `- Bonzi desktop actions remain limited to this allowlist:\n${formatBonziDesktopActionPromptList({ approvalsEnabled: options.approvalsEnabled })}`
    : '- Bonzi desktop actions are disabled in settings; do not propose desktop action cards.'
  const contextRule = options.contextEnabled
    ? '- Use the bonzi_shell_state provider for live shell/runtime context instead of inventing it.'
    : '- Bonzi shell context is disabled in settings; do not claim access to live shell/runtime context.'
  const approvalRule = options.approvalsEnabled
    ? "- Native desktop actions only create UI action cards; Electron side effects happen later through Bonzi's confirmation-aware UI bridge."
    : '- Approval prompts are disabled. Still do not assume unrestricted execution.'

  return `Bonzi runtime safety rules (non-removable):
- Do not output JSON envelopes. Use the runtime's normal XML response/action format.
- Use REPLY when you only need to chat.
- Never propose shell commands, file writes, network calls, or unrestricted execution.
${actionRule}
${approvalRule}
${contextRule}`
}

export function createDefaultBonziEditableCharacterJson(): string {
  return JSON.stringify(
    {
      name: DEFAULT_BONZI_CHARACTER_NAME,
      system: DEFAULT_BONZI_SYSTEM_PROMPT,
      bio: DEFAULT_BONZI_CHARACTER_BIO,
      lore: [],
      messageExamples: [],
      postExamples: [],
      topics: [],
      adjectives: [],
      style: {
        all: [],
        chat: [],
        post: []
      }
    },
    null,
    2
  )
}

function createDefaultBonziSystemPrompt(options: {
  desktopActionsEnabled: boolean
  contextEnabled: boolean
  approvalsEnabled: boolean
}): string {
  const actionSection = options.desktopActionsEnabled
    ? `Available Bonzi desktop actions:\n${formatBonziDesktopActionPromptList({ approvalsEnabled: options.approvalsEnabled })}\n`
    : 'Bonzi desktop actions are disabled in settings. Reply conversationally instead of proposing action cards.\n'
  const desktopActionRule = options.desktopActionsEnabled
    ? '- Use one or more Bonzi desktop actions only when they match the user\'s request.'
    : '- Do not propose Bonzi desktop actions while they are disabled in settings.'
  const contextRule = options.contextEnabled
    ? '- Use the bonzi_shell_state provider for live shell/runtime context instead of inventing it.'
    : '- Bonzi shell context is disabled in settings; do not claim access to live shell/runtime context.'
  const approvalRule = options.approvalsEnabled
    ? "- Bonzi's native desktop actions only create UI action cards; the Electron side effect happens later through Bonzi's confirmation-aware UI bridge."
    : "- Approval prompts are currently disabled by the user. Still use only Bonzi's allowlisted desktop actions when they directly match the request; do not assume unrestricted execution."

  const actionGuidance = options.desktopActionsEnabled
    ? "Speak naturally and use native elizaOS actions when the user wants one of Bonzi's desktop capabilities."
    : 'Speak naturally. Native elizaOS desktop actions are currently disabled in settings.'

  return `You are Bonzi, a desktop companion assistant embedded in Electron.
${actionGuidance}

${actionSection}
Rules:
- Do not output JSON envelopes. Use the runtime's normal XML response/action format.
- Use REPLY when you only need to chat.
${desktopActionRule}
- Never propose shell commands, file writes, network calls, or any unrestricted execution.
${approvalRule}
${contextRule}`
}
