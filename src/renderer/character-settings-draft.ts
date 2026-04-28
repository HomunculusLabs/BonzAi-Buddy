import {
  ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS,
  type ElizaCharacterEditableStyleField,
  type ElizaCharacterSettings
} from '../shared/contracts/character'

export interface CharacterEditorDraft {
  name: string
  system: string
  bioText: string
  loreText: string
  messageExamplesJson: string
  postExamplesText: string
  topicsText: string
  adjectivesText: string
  styleAllText: string
  styleChatText: string
  stylePostText: string
}

export type DraftSource = 'form' | 'json'

export interface DraftSnapshot {
  enabled: boolean
  draft: CharacterEditorDraft
  draftJson: string
  draftSource: DraftSource
}

type CharacterStyleDraftField = 'styleAllText' | 'styleChatText' | 'stylePostText'

const STYLE_DRAFT_FIELD_MAP = {
  all: 'styleAllText',
  chat: 'styleChatText',
  post: 'stylePostText'
} as const satisfies Record<ElizaCharacterEditableStyleField, CharacterStyleDraftField>

export function createEmptyDraft(): CharacterEditorDraft {
  return {
    name: '',
    system: '',
    bioText: '',
    loreText: '',
    messageExamplesJson: '[]',
    postExamplesText: '',
    topicsText: '',
    adjectivesText: '',
    styleAllText: '',
    styleChatText: '',
    stylePostText: ''
  }
}

export function createDraftFromSettings(
  settings: ElizaCharacterSettings
): CharacterEditorDraft {
  return createDraftFromCharacterJson(
    settings.defaultCharacterJson,
    settings.characterJson
  )
}

export function createDraftFromCharacterJson(
  defaultCharacterJson: string,
  characterJson: string
): CharacterEditorDraft {
  const defaults = parseCharacterRecord(defaultCharacterJson)
  const override = characterJson.trim() === '{}'
    ? {}
    : parseCharacterRecord(characterJson)
  const defaultStyle = isRecord(defaults.style) ? defaults.style : {}
  const overrideStyle = isRecord(override.style) ? override.style : {}
  const merged = {
    ...defaults,
    ...override,
    style: {
      ...defaultStyle,
      ...overrideStyle
    }
  }

  return createDraftFromRecord(merged)
}

export function createCharacterJsonFromDraft(draft: CharacterEditorDraft): string {
  const bioEntries = splitLines(draft.bioText)
  const messageExamples = parseJsonArray(
    draft.messageExamplesJson,
    'Eliza character message examples'
  )

  return JSON.stringify(
    {
      name: draft.name,
      system: draft.system,
      bio: bioEntries.length <= 1 ? draft.bioText.trim() : bioEntries,
      lore: splitLines(draft.loreText),
      messageExamples,
      postExamples: splitLines(draft.postExamplesText),
      topics: splitLines(draft.topicsText),
      adjectives: splitLines(draft.adjectivesText),
      style: createStyleRecordFromDraft(draft)
    },
    null,
    2
  )
}

function createDraftFromRecord(record: Record<string, unknown>): CharacterEditorDraft {
  const style = isRecord(record.style) ? record.style : {}

  return {
    name: readString(record.name),
    system: readString(record.system),
    bioText: readStringOrStringArray(record.bio),
    loreText: readStringArray(record.lore).join('\n'),
    messageExamplesJson: JSON.stringify(
      Array.isArray(record.messageExamples) ? record.messageExamples : [],
      null,
      2
    ),
    postExamplesText: readStringArray(record.postExamples).join('\n'),
    topicsText: readStringArray(record.topics).join('\n'),
    adjectivesText: readStringArray(record.adjectives).join('\n'),
    ...createStyleDraftFromRecord(style)
  }
}

function createStyleDraftFromRecord(
  style: Record<string, unknown>
): Pick<CharacterEditorDraft, CharacterStyleDraftField> {
  const styleDraft: Pick<CharacterEditorDraft, CharacterStyleDraftField> = {
    styleAllText: '',
    styleChatText: '',
    stylePostText: ''
  }

  for (const field of ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS) {
    styleDraft[STYLE_DRAFT_FIELD_MAP[field]] = readStringArray(style[field]).join('\n')
  }

  return styleDraft
}

function createStyleRecordFromDraft(
  draft: CharacterEditorDraft
): Record<ElizaCharacterEditableStyleField, string[]> {
  const style = {} as Record<ElizaCharacterEditableStyleField, string[]>

  for (const field of ELIZA_CHARACTER_EDITABLE_STYLE_FIELDS) {
    style[field] = splitLines(draft[STYLE_DRAFT_FIELD_MAP[field]])
  }

  return style
}

function parseJsonArray(value: string, label: string): unknown[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`)
    }
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} JSON is invalid: ${message}`)
  }
}

function parseCharacterRecord(characterJson: string): Record<string, unknown> {
  const trimmed = characterJson.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (isRecord(parsed) && !Array.isArray(parsed)) {
    return parsed
  }

  throw new Error('Eliza character JSON must be an object.')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function readStringOrStringArray(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return readStringArray(value).join('\n')
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
