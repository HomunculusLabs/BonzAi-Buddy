import type {
  ElizaCharacterSettings,
  UpdateElizaCharacterSettingsRequest
} from '../../shared/contracts'
import { isRecord } from '../../shared/value-utils'
import {
  createDefaultBonziEditableCharacterJson,
  isDefaultBonziEditableCharacterField
} from './bonzi-character'
import {
  DEFAULT_CHARACTER_SETTINGS,
  type NormalizedCharacterSettings,
  type PersistedCharacterSettings,
  type SanitizedBonziCharacterOverride,
  type SanitizedBonziMessageExample
} from './plugin-settings-model'

const MAX_CHARACTER_JSON_BYTES = 64 * 1024
const MAX_NAME_LENGTH = 80
const MAX_SYSTEM_LENGTH = 16_000
const MAX_STRING_ARRAY_ENTRIES = 50
const MAX_STRING_ARRAY_ENTRY_LENGTH = 2_000
const MAX_MESSAGE_EXAMPLE_CONVERSATIONS = 10
const MAX_MESSAGE_EXAMPLE_MESSAGES = 20

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'name',
  'system',
  'bio',
  'lore',
  'messageExamples',
  'postExamples',
  'topics',
  'adjectives',
  'style'
])

const DISALLOWED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'plugins',
  'settings',
  'clients',
  'secrets',
  'actions',
  'providers',
  'evaluators',
  'modelProvider',
  'templates',
  'knowledge',
  'advancedPlanning',
  'advancedMemory'
])

export function getDefaultCharacterSettings(): NormalizedCharacterSettings {
  return {
    ...DEFAULT_CHARACTER_SETTINGS,
    defaultCharacterJson: createDefaultBonziEditableCharacterJson(),
    warnings: [...DEFAULT_CHARACTER_SETTINGS.warnings]
  }
}

export function toElizaCharacterSettings(
  settings: NormalizedCharacterSettings
): ElizaCharacterSettings {
  return {
    enabled: settings.enabled,
    characterJson: settings.characterJson,
    defaultCharacterJson: createDefaultBonziEditableCharacterJson(),
    warnings: [...settings.warnings]
  }
}

export function toPersistedCharacterSettings(
  settings: NormalizedCharacterSettings
): PersistedCharacterSettings {
  return {
    enabled: settings.enabled,
    characterJson: settings.characterJson
  }
}

export function normalizePersistedCharacterSettings(value: unknown): {
  settings: NormalizedCharacterSettings
  needsRewrite: boolean
} {
  if (value === undefined) {
    return {
      settings: getDefaultCharacterSettings(),
      needsRewrite: true
    }
  }

  if (!isRecord(value) || Array.isArray(value)) {
    return invalidPersistedCharacterSettings('Stored Eliza character settings were malformed and were reset.')
  }

  if (typeof value.enabled !== 'boolean' || typeof value.characterJson !== 'string') {
    return invalidPersistedCharacterSettings('Stored Eliza character settings were malformed and were reset.')
  }

  try {
    const settings = sanitizeCharacterSettings({
      enabled: value.enabled,
      characterJson: value.characterJson
    })

    const hasUnsupportedKeys = Object.keys(value).some(
      (key) => key !== 'enabled' && key !== 'characterJson'
    )

    return {
      settings,
      needsRewrite:
        hasUnsupportedKeys ||
        value.enabled !== settings.enabled ||
        value.characterJson !== settings.characterJson
    }
  } catch {
    return invalidPersistedCharacterSettings('Stored Eliza character JSON was invalid and was reset.')
  }
}

export function validateCharacterSettingsUpdate(
  request: UpdateElizaCharacterSettingsRequest
): NormalizedCharacterSettings {
  if (!isRecord(request) || Array.isArray(request)) {
    throw new Error('Eliza character settings update must be an object.')
  }

  if (typeof request.enabled !== 'boolean') {
    throw new Error('Eliza character settings update must include an enabled boolean.')
  }

  if (typeof request.characterJson !== 'string') {
    throw new Error('Eliza character settings update must include a characterJson string.')
  }

  return sanitizeCharacterSettings({
    enabled: request.enabled,
    characterJson: request.characterJson
  })
}

function sanitizeCharacterSettings(input: {
  enabled: boolean
  characterJson: string
}): NormalizedCharacterSettings {
  const parsed = parseCharacterJson(input.characterJson)
  const override = stripDefaultCharacterTemplateFields(
    sanitizeCharacterOverride(parsed)
  )
  const characterJson = canonicalizeCharacterJson(override)

  return {
    enabled: input.enabled,
    characterJson,
    defaultCharacterJson: createDefaultBonziEditableCharacterJson(),
    warnings: [],
    override: Object.keys(override).length > 0 ? override : null
  }
}

function parseCharacterJson(characterJson: string): unknown {
  if (Buffer.byteLength(characterJson, 'utf8') > MAX_CHARACTER_JSON_BYTES) {
    throw new Error('Eliza character JSON must be 64 KiB or smaller.')
  }

  const trimmed = characterJson.trim()
  if (!trimmed) {
    return {}
  }

  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Eliza character JSON is invalid: ${message}`)
  }
}

function sanitizeCharacterOverride(value: unknown): SanitizedBonziCharacterOverride {
  if (!isPlainRecord(value)) {
    throw new Error('Eliza character JSON must be an object.')
  }

  assertNoDisallowedKeys(value)

  for (const key of Object.keys(value)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`Unsupported Eliza character field: ${key}`)
    }
  }

  const override: SanitizedBonziCharacterOverride = {}
  const name = normalizeLimitedString(value.name, 'name', MAX_NAME_LENGTH)
  if (name) {
    override.name = name
  }

  const system = normalizeLimitedString(value.system, 'system', MAX_SYSTEM_LENGTH)
  if (system) {
    override.system = system
  }

  const bio = normalizeBio(value.bio)
  if (bio !== undefined) {
    override.bio = bio
  }

  const lore = normalizeStringArrayField(value.lore, 'lore')
  if (lore) {
    override.lore = lore
  }

  const messageExamples = normalizeMessageExamples(value.messageExamples)
  if (messageExamples) {
    override.messageExamples = messageExamples
  }

  const postExamples = normalizeStringArrayField(value.postExamples, 'postExamples')
  if (postExamples) {
    override.postExamples = postExamples
  }

  const topics = normalizeStringArrayField(value.topics, 'topics')
  if (topics) {
    override.topics = topics
  }

  const adjectives = normalizeStringArrayField(value.adjectives, 'adjectives')
  if (adjectives) {
    override.adjectives = adjectives
  }

  const style = normalizeStyle(value.style)
  if (style) {
    override.style = style
  }

  return override
}

function normalizeBio(value: unknown): string | string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === 'string') {
    return normalizeLimitedString(value, 'bio', MAX_STRING_ARRAY_ENTRY_LENGTH)
  }

  return normalizeStringArrayField(value, 'bio')
}

function normalizeStyle(
  value: unknown
): SanitizedBonziCharacterOverride['style'] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isPlainRecord(value)) {
    throw new Error('Eliza character style must be an object.')
  }

  for (const key of Object.keys(value)) {
    if (key !== 'all' && key !== 'chat' && key !== 'post') {
      throw new Error(`Unsupported Eliza character style field: ${key}`)
    }
  }

  const style: NonNullable<SanitizedBonziCharacterOverride['style']> = {}
  const all = normalizeStringArrayField(value.all, 'style.all')
  if (all) {
    style.all = all
  }

  const chat = normalizeStringArrayField(value.chat, 'style.chat')
  if (chat) {
    style.chat = chat
  }

  const post = normalizeStringArrayField(value.post, 'style.post')
  if (post) {
    style.post = post
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function normalizeMessageExamples(
  value: unknown
): SanitizedBonziMessageExample[][] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error('Eliza character messageExamples must be an array.')
  }

  if (value.length > MAX_MESSAGE_EXAMPLE_CONVERSATIONS) {
    throw new Error(
      `Eliza character messageExamples supports at most ${MAX_MESSAGE_EXAMPLE_CONVERSATIONS} conversations.`
    )
  }

  let messageCount = 0
  const conversations: SanitizedBonziMessageExample[][] = []

  for (const conversation of value) {
    if (!Array.isArray(conversation)) {
      throw new Error('Each Eliza character messageExamples conversation must be an array.')
    }

    const messages: SanitizedBonziMessageExample[] = []

    for (const message of conversation) {
      if (!isPlainRecord(message)) {
        throw new Error('Each Eliza character message example must be an object.')
      }

      if (!isPlainRecord(message.content)) {
        throw new Error('Each Eliza character message example must include content.text.')
      }

      const text = normalizeLimitedString(
        message.content.text,
        'messageExamples.content.text',
        MAX_STRING_ARRAY_ENTRY_LENGTH
      )

      if (!text) {
        continue
      }

      messageCount += 1
      if (messageCount > MAX_MESSAGE_EXAMPLE_MESSAGES) {
        throw new Error(
          `Eliza character messageExamples supports at most ${MAX_MESSAGE_EXAMPLE_MESSAGES} messages.`
        )
      }

      messages.push({
        name:
          normalizeLimitedString(message.name, 'messageExamples.name', MAX_NAME_LENGTH) ??
          'User',
        content: { text }
      })
    }

    if (messages.length > 0) {
      conversations.push(messages)
    }
  }

  return conversations.length > 0 ? conversations : undefined
}

function normalizeStringArrayField(
  value: unknown,
  fieldName: string
): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error(`Eliza character ${fieldName} must be an array of strings.`)
  }

  if (value.length > MAX_STRING_ARRAY_ENTRIES) {
    throw new Error(
      `Eliza character ${fieldName} supports at most ${MAX_STRING_ARRAY_ENTRIES} entries.`
    )
  }

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    const normalizedEntry = normalizeLimitedString(
      entry,
      fieldName,
      MAX_STRING_ARRAY_ENTRY_LENGTH
    )

    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue
    }

    seen.add(normalizedEntry)
    normalized.push(normalizedEntry)
  }

  return normalized.length > 0 ? normalized : undefined
}

function normalizeLimitedString(
  value: unknown,
  fieldName: string,
  maxLength: number
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Eliza character ${fieldName} must be a string.`)
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  if (normalized.length > maxLength) {
    throw new Error(
      `Eliza character ${fieldName} must be ${maxLength} characters or fewer.`
    )
  }

  return normalized
}

function stripDefaultCharacterTemplateFields(
  override: SanitizedBonziCharacterOverride
): SanitizedBonziCharacterOverride {
  const stripped: SanitizedBonziCharacterOverride = { ...override }

  for (const fieldName of Object.keys(stripped) as Array<
    keyof SanitizedBonziCharacterOverride
  >) {
    if (isDefaultBonziEditableCharacterField(fieldName, stripped[fieldName])) {
      delete stripped[fieldName]
    }
  }

  return stripped
}

function canonicalizeCharacterJson(
  override: SanitizedBonziCharacterOverride
): string {
  if (Object.keys(override).length === 0) {
    return '{}'
  }

  return JSON.stringify(override, null, 2)
}

function assertNoDisallowedKeys(value: unknown, path = 'character'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDisallowedKeys(entry, `${path}[${index}]`))
    return
  }

  if (!isRecord(value)) {
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (DISALLOWED_KEYS.has(key)) {
      throw new Error(`Unsupported Eliza character field at ${path}.${key}.`)
    }

    assertNoDisallowedKeys(nestedValue, `${path}.${key}`)
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function invalidPersistedCharacterSettings(warning: string): {
  settings: NormalizedCharacterSettings
  needsRewrite: boolean
} {
  return {
    settings: {
      ...getDefaultCharacterSettings(),
      warnings: [warning]
    },
    needsRewrite: true
  }
}
