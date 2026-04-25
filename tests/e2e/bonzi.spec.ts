import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, expect, _electron as electron } from '@playwright/test'

interface RecordedRequest {
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
}

interface FakeOpenAiUpstream {
  baseUrl: string
  chatRequests: RecordedRequest[]
  embeddingsRequests: RecordedRequest[]
  close: () => Promise<void>
}

test('boots and completes an assistant roundtrip through the real Electron app', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-'))
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()

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
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('manages bundled optional plugins from settings catalog', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-plugins-'))
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.locator('[data-action="settings"]').click()

    const installedContextRow = window.locator(
      '[data-plugin-id="bonzi-context"][data-plugin-installed="true"]'
    )
    const availableContextRow = window.locator(
      '[data-plugin-id="bonzi-context"][data-plugin-available="true"]'
    )

    await expect(installedContextRow).toBeVisible()
    await expect(availableContextRow).toHaveCount(0)

    await installedContextRow.locator('[data-plugin-remove="bonzi-context"]').click()
    await expect(availableContextRow).toBeVisible()
    await expect(installedContextRow).toHaveCount(0)

    await availableContextRow.locator('[data-plugin-add="bonzi-context"]').click()
    await expect(installedContextRow).toBeVisible()
    await expect(availableContextRow).toHaveCount(0)

    const contextToggle = installedContextRow.locator(
      '[data-plugin-toggle="bonzi-context"]'
    )
    await expect(contextToggle).toBeChecked()
    await contextToggle.uncheck()
    await expect(installedContextRow.locator('.plugin-row__status')).toHaveText(
      'Disabled'
    )
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('routes live embedding requests through the managed embeddings proxy', async () => {
  const upstream = await startFakeOpenAiUpstream()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-embed-'))
  const env = {
    ...process.env,
    BONZI_ASSISTANT_PROVIDER: 'openai-compatible',
    BONZI_OPENAI_API_KEY: 'test-chat-key',
    BONZI_OPENAI_BASE_URL: `${upstream.baseUrl}/v1`,
    BONZI_OPENAI_MODEL: 'fake-chat-model',
    BONZI_OPENAI_EMBEDDING_DIMENSIONS: '1536',
    BONZI_EMBEDDINGS_UPSTREAM_URL: `${upstream.baseUrl}/v1`,
    BONZI_EMBEDDINGS_UPSTREAM_MODEL: 'text-embedding-test',
    BONZI_EMBEDDINGS_UPSTREAM_API_KEY: 'test-embedding-key',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()

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
    await app.close()
    await upstream.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

async function startFakeOpenAiUpstream(): Promise<FakeOpenAiUpstream> {
  const chatRequests: RecordedRequest[] = []
  const embeddingsRequests: RecordedRequest[] = []
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/embeddings') {
      const body = await readJsonBody(request)
      const recordedRequest: RecordedRequest = {
        headers: request.headers,
        body: isRecord(body) ? body : {}
      }

      embeddingsRequests.push(recordedRequest)
      writeJson(response, 200, {
        object: 'list',
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: Array.from({ length: 1536 }, (_, index) => index / 1536)
          }
        ],
        model: 'text-embedding-test',
        usage: {
          prompt_tokens: 4,
          total_tokens: 4
        }
      })
      return
    }

    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const body = await readJsonBody(request)
      const recordedRequest: RecordedRequest = {
        headers: request.headers,
        body: isRecord(body) ? body : {}
      }
      chatRequests.push(recordedRequest)
      const userText = extractLatestUserText(recordedRequest.body)
      writeJson(response, 200, {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake-chat-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                reply: `Managed embeddings proxy reply: ${userText}`,
                actions: []
              })
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20
        }
      })
      return
    }

    if (request.method === 'GET' && request.url === '/v1/models') {
      writeJson(response, 200, {
        object: 'list',
        data: [
          { id: 'fake-chat-model', object: 'model' },
          { id: 'text-embedding-test', object: 'model' }
        ]
      })
      return
    }

    writeJson(response, 404, {
      error: {
        message: 'Not found'
      }
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind fake OpenAI upstream server.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chatRequests,
    embeddingsRequests,
    close: () => closeServer(server)
  }
}

function serializedRequestBodies(requests: RecordedRequest[]): string {
  return requests.map((request) => JSON.stringify(request.body)).join('\n')
}

function extractLatestUserText(body: Record<string, unknown>): string {
  const messages = body.messages
  if (!Array.isArray(messages)) {
    return 'unknown'
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'user') {
      continue
    }

    const content = message.content
    if (typeof content === 'string' && content.trim()) {
      return content.trim()
    }
  }

  return 'unknown'
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>
): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
