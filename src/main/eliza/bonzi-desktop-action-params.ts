import type {
  AssistantActionParams,
  AssistantActionType
} from '../../shared/contracts'
import {
  hasAssistantActionParams,
  normalizeDiscordDraftText,
  normalizePromptText,
  normalizeScrollAmount,
  normalizeScrollDirection,
  normalizeSurfArgs,
  normalizeSurfCommand,
  normalizeText,
  normalizeWorkspaceFileContent,
  normalizeWorkspaceFilePath,
  truncate
} from '../assistant-action-param-utils'

export function createActionParams(
  type: AssistantActionType,
  parameters: Record<string, unknown>,
  messageText: string
): AssistantActionParams | undefined {
  switch (type) {
    case 'open-url': {
      const url =
        normalizeText(parameters.url) || inferUrlLikeText(messageText)
      return url ? { url: truncate(url, 2_048) } : undefined
    }
    case 'search-web': {
      const query =
        normalizeText(parameters.query) || inferSearchQueryFromText(messageText)
      return query ? { query: truncate(query, 500) } : undefined
    }
    case 'discord-snapshot': {
      const query = normalizeText(parameters.query)
      return query ? { query: truncate(query, 200) } : undefined
    }
    case 'hermes-run': {
      const prompt = normalizePromptText(parameters.prompt) || inferHermesPromptFromText(messageText)
      return prompt ? { prompt: truncate(prompt, 24_000) } : undefined
    }
    case 'inspect-cron-jobs': {
      const query = normalizeText(parameters.query) || inferCronQueryFromText(messageText)
      return query ? { query: truncate(query, 200) } : undefined
    }
    case 'discord-read-context': {
      const url = normalizeText(parameters.url) || inferDiscordUrlFromText(messageText)
      const query = normalizeText(parameters.query)
      const params: AssistantActionParams = {}

      if (url) {
        params.url = truncate(url, 2_048)
      }

      if (query) {
        params.query = truncate(query, 500)
      }

      return hasAssistantActionParams(params) ? params : undefined
    }
    case 'discord-scroll': {
      const direction = normalizeScrollDirection(parameters.direction) || inferScrollDirectionFromText(messageText)
      const amount = normalizeScrollAmount(parameters.amount)
      return direction ? { direction, amount } : undefined
    }
    case 'discord-type-draft': {
      const text = normalizeDiscordDraftText(parameters.text) || normalizeDiscordDraftText(inferDiscordDraftText(messageText))
      const url = normalizeText(parameters.url) || inferDiscordUrlFromText(messageText)
      const params: AssistantActionParams = {}

      if (text) {
        params.text = truncate(text, 2_000)
      }

      if (url) {
        params.url = truncate(url, 2_048)
      }

      return hasAssistantActionParams(params) ? params : undefined
    }
    case 'workspace-list-files': {
      const filePath = normalizeWorkspaceFilePath(parameters.filePath)
      return filePath ? { filePath: truncate(filePath, 500) } : undefined
    }
    case 'workspace-read-file': {
      const filePath = normalizeWorkspaceFilePath(parameters.filePath)
      return filePath ? { filePath: truncate(filePath, 500) } : undefined
    }
    case 'workspace-write-file': {
      const filePath = normalizeWorkspaceFilePath(parameters.filePath)
      const content =
        typeof parameters.content === 'string'
          ? normalizeWorkspaceFileContent(parameters.content)
          : undefined
      const params: AssistantActionParams = {}

      if (filePath) {
        params.filePath = truncate(filePath, 500)
      }

      if (content !== undefined) {
        params.content = truncate(content, 20_000)
      }

      return hasAssistantActionParams(params) ? params : undefined
    }
    default:
      return undefined
  }
}

export function hasRequiredActionParams(
  type: AssistantActionType,
  params: AssistantActionParams | undefined
): boolean {
  switch (type) {
    case 'open-url':
      return Boolean(params?.url)
    case 'search-web':
      return Boolean(params?.query)
    case 'discord-scroll':
      return params?.direction === 'up' || params?.direction === 'down'
    case 'hermes-run':
      return Boolean(params?.prompt)
    case 'inspect-cron-jobs':
      return true
    case 'discord-type-draft':
      return Boolean(params?.text)
    case 'workspace-read-file':
      return Boolean(params?.filePath)
    case 'workspace-write-file':
      return Boolean(params?.filePath) && params?.content !== undefined
    default:
      return true
  }
}

function inferUrlLikeText(text: string): string {
  const explicitUrl = text.match(/https?:\/\/[^\s<>'"]+/i)?.[0]

  if (explicitUrl) {
    return stripTrailingSentencePunctuation(explicitUrl)
  }

  const domain = text.match(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s<>'"]*)?/i
  )?.[0]

  return domain ? stripTrailingSentencePunctuation(domain) : ''
}

function inferDiscordUrlFromText(text: string): string {
  const url = inferUrlLikeText(text)

  if (!url) {
    return ''
  }

  return /^(?:https?:\/\/)?(?:discord\.com|discordapp\.com)\/channels\//i.test(url)
    ? url
    : ''
}

function inferSearchQueryFromText(text: string): string {
  const trimmed = text.trim()
  const commandMatch = trimmed.match(
    /^(?:please\s+)?(?:search|look\s+up|google|find)(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?(?:\s+(.+))?$/i
  )

  if (commandMatch) {
    return commandMatch[1]?.trim() ?? ''
  }

  return trimmed
}

function inferHermesPromptFromText(text: string): string {
  const trimmed = text.trim()
  const quoted = trimmed.match(/[“"]([^”"]{1,24000})[”"]/u)?.[1]

  if (quoted) {
    return normalizePromptText(quoted)
  }

  const match = trimmed.match(
    /(?:consult|ask|run|delegate\s+to)\s+hermes(?:\s+(?:about|on|for|with))?\s*[:：]?\s*(.+)$/isu
  )

  return normalizePromptText(match?.[1] ?? '')
}

function inferCronQueryFromText(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(
    /(?:hermes\s+)?(?:cron|scheduled)\s+jobs?\s+(?:for|about|matching)\s+(.+)$/iu
  )

  if (match?.[1]) {
    return match[1].trim()
  }

  const llmWikiMatch = trimmed.match(/\bllm\s+wiki\b/iu)
  if (llmWikiMatch) {
    return llmWikiMatch[0]
  }

  return ''
}

function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, '')
}

function inferScrollDirectionFromText(text: string): 'up' | 'down' | undefined {
  if (/\b(up|older|previous|back)\b/i.test(text)) {
    return 'up'
  }

  if (/\b(down|newer|next|forward)\b/i.test(text)) {
    return 'down'
  }

  return undefined
}

function inferDiscordDraftText(text: string): string {
  const quoted = text.match(/[“"]([^”"]{1,2000})[”"]/u)?.[1]

  if (quoted) {
    return quoted.trim()
  }

  const draftMatch = text.match(
    /(?:draft|type|reply(?:\s+with)?|respond(?:\s+with)?|say)\s*[:：]?\s*(.+)$/is
  )

  return draftMatch?.[1]?.trim() ?? ''
}
