import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { startFakeOpenAiUpstream } from './fixtures/fake-servers'
import { serializedRequestBodies } from './fixtures/request-helpers'

test('boots and completes an assistant roundtrip through the real Electron app', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-'
  })

  try {
    const { window } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const hasAssistantBridge = await window.evaluate(() => {
      return typeof window.bonzi?.assistant?.sendCommand === 'function'
    })
    expect(hasAssistantBridge).toBe(true)

    await window.locator('.stage-shell').dblclick()

    const commandInput = window.locator('#assistant-command')
    await expect(commandInput).toBeEnabled()

    const command = 'show shell state e2e'
    await commandInput.fill(command)
    await commandInput.press('Enter')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText(`E2E assistant reply for: ${command}`)

    await expect(window.locator('.action-chip')).toHaveCount(1)
  } finally {
    await session.close()
  }
})

test('routes live embedding requests through the managed embeddings proxy', async () => {
  const upstream = await startFakeOpenAiUpstream()
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-embed-',
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
    const { window } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await expect.poll(() => upstream.embeddingsRequests.length).toBeGreaterThan(0)

    const startupProbe = upstream.embeddingsRequests[0]
    expect(startupProbe.headers.authorization).toBe('Bearer test-embedding-key')
    expect(startupProbe.body.model).toBe('text-embedding-test')
    expect(startupProbe.body.dimensions).toBe(1536)
    expect(startupProbe.body.input).toBe('Bonzi embeddings startup probe')

    await window.locator('.stage-shell').dblclick()
    const commandInput = window.locator('#assistant-command')
    await expect(commandInput).toBeEnabled()

    const command = 'managed embeddings proxy roundtrip'
    await commandInput.fill(command)
    await commandInput.press('Enter')

    await expect.poll(() => upstream.chatRequests.length).toBeGreaterThan(0)
    expect(serializedRequestBodies(upstream.chatRequests)).toContain(command)

    await expect
      .poll(() =>
        upstream.embeddingsRequests.filter(
          (request) => request.body.input !== 'Bonzi embeddings startup probe'
        ).length
      )
      .toBeGreaterThan(0)
  } finally {
    await session.close()
    await upstream.close()
  }
})
