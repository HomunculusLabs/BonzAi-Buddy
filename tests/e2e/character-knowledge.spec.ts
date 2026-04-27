import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { setTextareaValue } from './fixtures/dom'
import { startFakeOpenAiUpstream } from './fixtures/fake-servers'
import { readJsonFile } from './fixtures/json'
import { serializedRequestBodies } from './fixtures/request-helpers'

test('saves custom Eliza character JSON, reloads runtime, and rejects malformed drafts', async () => {
  const upstream = await startFakeOpenAiUpstream()
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-character-',
    env: {
      BONZI_ASSISTANT_PROVIDER: 'openai-compatible',
      BONZI_OPENAI_API_KEY: 'test-chat-key',
      BONZI_OPENAI_BASE_URL: `${upstream.baseUrl}/v1`,
      BONZI_OPENAI_MODEL: 'fake-chat-model',
      BONZI_OPENAI_EMBEDDING_DIMENSIONS: '1536',
      BONZI_EMBEDDINGS_UPSTREAM_URL: `${upstream.baseUrl}/v1`,
      BONZI_EMBEDDINGS_UPSTREAM_MODEL: 'text-embedding-test',
      BONZI_EMBEDDINGS_UPSTREAM_API_KEY: 'test-embedding-key'
    }
  })

  try {
    const { window, userDataDir } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="character"]').click()

    const characterSection = window.locator('[data-character-settings]')
    await expect(characterSection).toBeVisible()
    await expect(characterSection.locator('[data-character-name]')).toHaveValue('Bonzi')
    await expect(characterSection.locator('[data-character-system]')).toHaveValue(
      /You are Bonzi/
    )
    await expect(characterSection.locator('[data-character-bio]')).toHaveValue(
      /desktop companion assistant/
    )
    await expect(
      characterSection.locator('[data-character-message-examples]')
    ).toHaveValue(/Can you search the web for cute jellyfish facts/)
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /"name": "Bonzi"/
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /"system": "You are Bonzi/
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /"topics": \[/
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /desktop assistance/
    )

    const marker = 'E2E_CUSTOM_CHARACTER_SYSTEM_MARKER'

    await characterSection.locator('[data-character-enabled]').check()
    await characterSection.locator('[data-character-name]').fill('E2E Custom Bonzi')
    await setTextareaValue(characterSection.locator('[data-character-system]'), marker)
    await setTextareaValue(
      characterSection.locator('[data-character-topics]'),
      'desktop helpers\ne2e topic'
    )
    await setTextareaValue(
      characterSection.locator('[data-character-style-chat]'),
      'keep replies concise'
    )
    await characterSection.locator('[data-character-save]').click()

    await expect(window.locator('[data-settings-status]')).toContainText(
      'Saved Eliza character settings'
    )
    const applyRuntimeChanges = window.locator(
      '[data-action="apply-runtime-changes"]'
    )
    await expect(applyRuntimeChanges).toBeVisible()

    const persistedAfterSave = await readJsonFile<{
      schemaVersion?: number
      character?: {
        enabled?: boolean
        characterJson?: string
        knowledge?: string[]
      }
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persistedAfterSave.schemaVersion).toBe(2)
    expect(persistedAfterSave.character?.enabled).toBe(true)
    const persistedCharacterJson = JSON.parse(
      persistedAfterSave.character?.characterJson ?? '{}'
    ) as {
      name?: string
      system?: string
      topics?: string[]
      style?: { chat?: string[] }
    }
    expect(persistedCharacterJson.name).toBe('E2E Custom Bonzi')
    expect(persistedCharacterJson.system).toBe(marker)
    expect(persistedCharacterJson.topics).toEqual(['desktop helpers', 'e2e topic'])
    expect(persistedCharacterJson.style?.chat).toEqual(['keep replies concise'])
    expect(persistedAfterSave.character?.knowledge).toBeUndefined()

    await applyRuntimeChanges.click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Runtime reload complete.'
    )
    await expect(applyRuntimeChanges).toBeHidden()
    await expect
      .poll(async () => {
        try {
          await readFile(
            join(
              userDataDir,
              'eliza-localdb',
              'character-knowledge',
              'bulk-knowledge.md'
            ),
            'utf8'
          )
          return 'present'
        } catch {
          return 'missing'
        }
      })
      .toBe('missing')

    upstream.chatRequests.length = 0
    const response = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'character marker e2e' })
    )
    expect(response.ok).toBe(true)
    await expect.poll(() => serializedRequestBodies(upstream.chatRequests)).toContain(marker)

    const knowledgeMarker = 'E2E_MARKDOWN_KNOWLEDGE_ALPHA'
    await window.locator('[data-settings-tab="knowledge"]').click()
    await expect(window.locator('[data-knowledge-settings]')).toBeVisible()
    upstream.embeddingsRequests.length = 0
    const importResult = await window.evaluate(
      (markdown) =>
        window.bonzi.settings.importKnowledgeDocuments({
          documents: [
            {
              name: 'e2e-import.md',
              content: markdown,
              lastModified: 1
            }
          ]
        }),
      `# E2E Knowledge\n\n${knowledgeMarker}: Bonzi can retrieve imported markdown knowledge.`
    )
    expect(importResult.ok).toBe(true)
    expect(importResult.status.importedChunks).toBeGreaterThan(0)
    expect(importResult.documents[0]?.status).toBe('imported')

    const knowledgeStatus = await window.evaluate(() =>
      window.bonzi.settings.getKnowledgeImportStatus()
    )
    expect(knowledgeStatus.state).toBe('succeeded')
    expect(knowledgeStatus.importedChunks).toBe(importResult.status.importedChunks)
    await expect
      .poll(() => serializedRequestBodies(upstream.embeddingsRequests))
      .toContain(knowledgeMarker)

    const persistedAfterKnowledgeImport = await readJsonFile<{
      character?: { knowledge?: string[] }
    }>(join(userDataDir, 'bonzi-settings.json'))
    expect(persistedAfterKnowledgeImport.character?.knowledge).toBeUndefined()
    await expect
      .poll(async () => {
        try {
          await readFile(
            join(
              userDataDir,
              'eliza-localdb',
              'character-knowledge',
              'bulk-knowledge.md'
            ),
            'utf8'
          )
          return 'present'
        } catch {
          return 'missing'
        }
      })
      .toBe('missing')

    upstream.chatRequests.length = 0
    upstream.embeddingsRequests.length = 0
    const knowledgeQuery = 'What did the imported markdown say about the alpha code?'
    const knowledgeResponse = await window.evaluate(
      (command) => window.bonzi.assistant.sendCommand({ command }),
      knowledgeQuery
    )
    expect(knowledgeResponse.ok).toBe(true)
    await expect
      .poll(() => serializedRequestBodies(upstream.embeddingsRequests))
      .toContain(knowledgeQuery)
    await expect.poll(() => serializedRequestBodies(upstream.chatRequests)).toContain(
      '# Relevant Knowledge'
    )
    expect(serializedRequestBodies(upstream.chatRequests)).toContain(knowledgeMarker)

    await window.locator('[data-settings-tab="character"]').click()
    await setTextareaValue(characterSection.locator('[data-character-json]'), '{')
    await characterSection.locator('[data-character-save]').click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Failed to save Eliza character settings'
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue('{')

    const persistedAfterInvalidSave = await readJsonFile<{
      character?: {
        enabled?: boolean
        characterJson?: string
        knowledge?: string[]
      }
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persistedAfterInvalidSave.character?.enabled).toBe(true)
    expect(persistedAfterInvalidSave.character?.characterJson).toBe(
      persistedAfterSave.character?.characterJson
    )
    expect(persistedAfterInvalidSave.character?.knowledge).toBeUndefined()

    await characterSection.locator('[data-character-reset]').click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Saved Eliza character settings'
    )
    await expect(characterSection.locator('[data-character-name]')).toHaveValue('Bonzi')
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /\"name\": \"Bonzi\"/
    )

    const persistedAfterReset = await readJsonFile<{
      character?: {
        enabled?: boolean
        characterJson?: string
        knowledge?: string[]
      }
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persistedAfterReset.character?.enabled).toBe(false)
    expect(persistedAfterReset.character?.characterJson).toBe('{}')
    expect(persistedAfterReset.character?.knowledge).toBeUndefined()

    await applyRuntimeChanges.click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Runtime reload complete.'
    )
    await expect
      .poll(async () => {
        try {
          await readFile(
            join(
              userDataDir,
              'eliza-localdb',
              'character-knowledge',
              'bulk-knowledge.md'
            ),
            'utf8'
          )
          return 'present'
        } catch {
          return 'missing'
        }
      })
      .toBe('missing')
  } finally {
    await session.close()
    await upstream.close()
  }
})
