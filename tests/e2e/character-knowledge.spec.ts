import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { setTextareaValue } from './fixtures/dom'
import { startFakeOpenAiUpstream } from './fixtures/fake-servers'
import { readJsonFile } from './fixtures/json'
import { BonziRuntimeMemoryService } from '../../src/main/eliza/runtime-memory-service'
import { serializedRequestBodies } from './fixtures/request-helpers'


test('recovers knowledge import status from persisted knowledge memory count', async () => {
  const service = new BonziRuntimeMemoryService({
    getRuntime: async () => ({
      roomId: '00000000-0000-0000-0000-000000000001',
      runtime: {
        countMemories: async (roomId: string, unique?: boolean, tableName?: string) => {
          expect(roomId).toBe('00000000-0000-0000-0000-000000000001')
          expect(unique).toBe(false)
          expect(tableName).toBe('knowledge')
          return 7
        },
        getMemories: async () => []
      }
    } as any)
  })

  const status = await service.getKnowledgeImportStatus()

  expect(status.state).toBe('idle')
  expect(status.recovered).toBe(true)
  expect(status.importedChunks).toBe(7)
  expect(status.knowledgeMemoryCount).toBe(7)
  expect(status.message).toContain('7 imported chunks')
  expect(status.recentDocuments).toEqual([])
})

test('skips unchanged folder Markdown files on re-import without new embedding requests', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bonzi-knowledge-manifest-'))
  const folderRoot = join(tempRoot, 'knowledge-folder')
  const manifestPath = join(tempRoot, 'knowledge-import-manifest.json')
  const embeddedTexts: string[] = []
  const persistedKnowledgeMemories = new Map<string, unknown>()

  await mkdir(folderRoot, { recursive: true })
  await writeFile(
    join(folderRoot, 'root.md'),
    '# Root\n\nE2E_MANIFEST_SKIP_MARKER: manifest skip should avoid second import embedding requests.',
    'utf8'
  )

  const service = new BonziRuntimeMemoryService({
    knowledgeImportManifestPath: manifestPath,
    getRuntime: async () => ({
      userId: '00000000-0000-0000-0000-000000000001',
      roomId: '00000000-0000-0000-0000-000000000002',
      worldId: '00000000-0000-0000-0000-000000000003',
      runtime: {
        agentId: '00000000-0000-0000-0000-000000000004',
        getMemoryById: async (id: string) => persistedKnowledgeMemories.get(String(id)) ?? null,
        addEmbeddingToMemory: async (memory: any) => {
          embeddedTexts.push(String(memory?.content?.text ?? ''))
          return memory
        },
        createMemory: async (memory: any) => {
          persistedKnowledgeMemories.set(String(memory?.id ?? ''), memory)
        },
        getMemories: async () => []
      }
    } as any)
  })

  try {
    const firstStart = await service.startKnowledgeFolderImport({
      folderPaths: [folderRoot]
    })
    expect(firstStart.ok).toBe(true)
    await expect
      .poll(async () => (await service.getKnowledgeImportStatus()).state, { timeout: 15_000 })
      .toBe('succeeded')
    const firstStatus = await service.getKnowledgeImportStatus()
    const firstEmbeddingCount = embeddedTexts.length
    expect(firstStatus.importedDocuments).toBe(1)
    expect(firstStatus.skippedDocuments).toBe(0)
    expect(firstEmbeddingCount).toBeGreaterThan(0)

    const secondStart = await service.startKnowledgeFolderImport({
      folderPaths: [folderRoot]
    })
    expect(secondStart.ok).toBe(true)
    await expect
      .poll(async () => (await service.getKnowledgeImportStatus()).state, { timeout: 15_000 })
      .toBe('succeeded')
    const secondStatus = await service.getKnowledgeImportStatus()
    expect(secondStatus.importedDocuments).toBe(0)
    expect(secondStatus.skippedDocuments).toBe(1)
    expect(secondStatus.importedChunks).toBe(0)
    expect(embeddedTexts).toHaveLength(firstEmbeddingCount)
    expect(secondStatus.recentDocuments?.[0]?.status).toBe('skipped')
    expect(secondStatus.recentDocuments?.[0]?.error).toBe(
      'Already imported; unchanged since last import.'
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

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

    const folderRoot = join(userDataDir, 'knowledge-folder-fixture')
    await mkdir(join(folderRoot, 'nested'), { recursive: true })
    const folderRootMarker = 'E2E_FOLDER_KNOWLEDGE_ROOT_MARKER'
    const folderNestedMarker = 'E2E_FOLDER_KNOWLEDGE_NESTED_MARKER'
    await writeFile(
      join(folderRoot, 'root.md'),
      `# Folder Root\n\n${folderRootMarker}: root folder markdown was imported.`,
      'utf8'
    )
    await writeFile(
      join(folderRoot, 'nested', 'deeper.md'),
      `# Folder Nested\n\n${folderNestedMarker}: nested markdown was imported.`,
      'utf8'
    )
    await writeFile(join(folderRoot, 'ignored.txt'), 'not markdown', 'utf8')

    upstream.embeddingsRequests.length = 0
    const folderImportStart = await window.evaluate((folderPath) =>
      window.bonzi.settings.importKnowledgeFolders({ folderPaths: [folderPath] }),
      folderRoot
    )
    expect(folderImportStart.ok).toBe(true)
    await expect
      .poll(
        () => window.evaluate(() => window.bonzi.settings.getKnowledgeImportStatus().then((status) => status.state)),
        { timeout: 30_000 }
      )
      .toBe('succeeded')
    const folderStatus = await window.evaluate(() =>
      window.bonzi.settings.getKnowledgeImportStatus()
    )
    expect(folderStatus.totalDocuments).toBe(2)
    expect(folderStatus.processedDocuments).toBe(2)
    expect(folderStatus.importedDocuments).toBe(2)
    expect(folderStatus.importedChunks).toBeGreaterThan(0)
    await expect
      .poll(() => serializedRequestBodies(upstream.embeddingsRequests))
      .toContain(folderRootMarker)
    expect(serializedRequestBodies(upstream.embeddingsRequests)).toContain(folderNestedMarker)

    const persistedAfterFolderImport = await readJsonFile<{
      character?: { knowledge?: string[] }
    }>(join(userDataDir, 'bonzi-settings.json'))
    expect(persistedAfterFolderImport.character?.knowledge).toBeUndefined()
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
    const knowledgeQuery = 'What did the imported markdown say about the nested folder marker?'
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
    expect(serializedRequestBodies(upstream.chatRequests)).toContain(folderNestedMarker)

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

test('recursively imports folder Markdown into knowledge memory and retrieves it', async () => {
  const upstream = await startFakeOpenAiUpstream()
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-knowledge-folder-',
    env: {
      BONZI_E2E_MODE: '0',
      BONZI_E2E_ALLOW_RAW_KNOWLEDGE_FOLDER_PATHS: '1',
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

    const folderRoot = join(userDataDir, 'knowledge-folder-fixture')
    await mkdir(join(folderRoot, 'nested'), { recursive: true })
    const folderRootMarker = 'E2E_STANDALONE_FOLDER_ROOT_MARKER'
    const folderNestedMarker = 'E2E_STANDALONE_FOLDER_NESTED_MARKER'
    await writeFile(
      join(folderRoot, 'root.md'),
      `# Folder Root\n\n${folderRootMarker}: root folder markdown was imported.`,
      'utf8'
    )
    await writeFile(
      join(folderRoot, 'nested', 'deeper.md'),
      `# Folder Nested\n\n${folderNestedMarker}: nested markdown was imported.`,
      'utf8'
    )
    await writeFile(join(folderRoot, 'ignored.txt'), 'not markdown', 'utf8')

    upstream.embeddingsRequests.length = 0
    const folderImportStart = await window.evaluate((folderPath) =>
      window.bonzi.settings.importKnowledgeFolders({ folderPaths: [folderPath] }),
      folderRoot
    )
    expect(folderImportStart.ok).toBe(true)

    await expect
      .poll(
        () => window.evaluate(() => window.bonzi.settings.getKnowledgeImportStatus().then((status) => status.state)),
        { timeout: 30_000 }
      )
      .toBe('succeeded')

    const folderStatus = await window.evaluate(() =>
      window.bonzi.settings.getKnowledgeImportStatus()
    )
    expect(folderStatus.totalDocuments).toBe(2)
    expect(folderStatus.processedDocuments).toBe(2)
    expect(folderStatus.importedDocuments).toBe(2)
    expect(folderStatus.importedChunks).toBeGreaterThan(0)
    await expect
      .poll(() => serializedRequestBodies(upstream.embeddingsRequests))
      .toContain(folderRootMarker)
    expect(serializedRequestBodies(upstream.embeddingsRequests)).toContain(folderNestedMarker)

    upstream.chatRequests.length = 0
    upstream.embeddingsRequests.length = 0
    const knowledgeQuery = 'What did the imported markdown say about the standalone nested folder marker?'
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
    expect(serializedRequestBodies(upstream.chatRequests)).toContain(folderNestedMarker)
  } finally {
    await session.close()
    await upstream.close()
  }
})

test('rejects recursive folder knowledge import over 10000 Markdown files before embedding', async () => {
  test.slow()
  const upstream = await startFakeOpenAiUpstream()
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-knowledge-cap-',
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

    const capRoot = join(userDataDir, 'knowledge-cap-fixture')
    await mkdir(capRoot, { recursive: true })

    for (let start = 0; start < 10_001; start += 250) {
      await Promise.all(
        Array.from({ length: Math.min(250, 10_001 - start) }, (_, offset) => {
          const index = start + offset
          return writeFile(join(capRoot, `doc-${index}.md`), `# Doc ${index}\n\nCap marker ${index}`, 'utf8')
        })
      )
    }

    upstream.embeddingsRequests.length = 0
    const importStart = await window.evaluate((folderPath) =>
      window.bonzi.settings.importKnowledgeFolders({ folderPaths: [folderPath] }),
      capRoot
    )
    expect(importStart.ok).toBe(true)

    await expect
      .poll(
        () => window.evaluate(() => window.bonzi.settings.getKnowledgeImportStatus().then((status) => status.state)),
        { timeout: 30_000 }
      )
      .toBe('failed')

    const status = await window.evaluate(() =>
      window.bonzi.settings.getKnowledgeImportStatus()
    )
    expect(status.message).toContain('10,000 Markdown files')
    expect(status.importedChunks).toBe(0)
    expect(upstream.embeddingsRequests).toHaveLength(0)
  } finally {
    await session.close()
    await upstream.close()
  }
})
