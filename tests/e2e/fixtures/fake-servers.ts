import { once } from 'node:events'
import { createServer } from 'node:http'
import {
  closeServer,
  extractLatestUserText,
  isRecord,
  readJsonBody,
  type RecordedRequest,
  writeJson
} from './request-helpers'

export interface FakeOpenAiUpstream {
  baseUrl: string
  chatRequests: RecordedRequest[]
  embeddingsRequests: RecordedRequest[]
  close: () => Promise<void>
}

export interface FakePluginRegistry {
  baseUrl: string
  requests: number
  close: () => Promise<void>
}

export interface FakeDiscordDomServer {
  url: string
  close: () => Promise<void>
}

export async function startFakeDiscordDomServer(): Promise<FakeDiscordDomServer> {
  const server = createServer((request, response) => {
    if (
      request.method === 'GET' &&
      request.url?.startsWith('/channels/test/server/channel')
    ) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Fake Discord Channel</title></head>
  <body>
    <main>
      <h1>#general</h1>
      <section data-list-id="chat-messages" aria-label="Messages in general">
        <article role="article" id="chat-messages-1">
          <h3><span id="message-username-1">Alice</span></h3>
          <time datetime="2026-04-27T12:00:00.000Z">Today at noon</time>
          <div id="message-content-1">Can Bonzi read this channel?</div>
        </article>
        <article role="article" id="chat-messages-2">
          <h3><span id="message-username-2">Bob</span></h3>
          <time datetime="2026-04-27T12:01:00.000Z">Today at 12:01</time>
          <div id="message-content-2">Yes, from the browser DOM.</div>
        </article>
      </section>
      <div role="textbox" contenteditable="true" aria-label="Message #general"></div>
    </main>
  </body>
</html>`)
      return
    }

    response.statusCode = 404
    response.end('Not found')
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind fake Discord DOM server.')
  }

  return {
    url: `http://127.0.0.1:${address.port}/channels/test/server/channel`,
    close: () => closeServer(server)
  }
}

export async function startFakePluginRegistry(): Promise<FakePluginRegistry> {
  let requests = 0
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/plugins.json') {
      requests += 1
      writeJson(response, 200, {
        plugins: [
          {
            id: 'weather',
            name: 'Weather',
            packageName: '@elizaos/plugin-weather',
            description: 'Gets weather reports.',
            version: '1.2.3',
            repository: 'https://github.com/elizaos/plugin-weather',
            compatibility: ['bonzi>=0.1.0'],
            capabilities: ['weather']
          },
          {
            id: 'legacy-bot',
            description: 'Legacy plugin that should be marked incompatible.',
            packageName: '@elizaos/plugin-legacy-bot',
            compatibility: {
              compatible: false
            }
          },
          {
            id: '@bealers/plugin-mattermost',
            git: {
              repo: 'bealers/plugin-mattermost',
              v0: { version: 'v0.5.0' },
              v1: { version: null },
              alpha: { version: null }
            },
            npm: {
              repo: '@bealers/plugin-mattermost',
              v0: '0.5.1',
              description:
                'Mattermost client plugin for ElizaOS - enables AI agent integration with Mattermost chat platforms',
              v1: null,
              alpha: null,
              v0CoreRange: 'latest',
              v1CoreRange: null,
              alphaCoreRange: null
            },
            supports: {
              v0: false,
              v1: false,
              alpha: false
            },
            description: null,
            homepage: null,
            topics: [],
            stargazers_count: 0,
            language: 'TypeScript'
          }
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
    throw new Error('Failed to bind fake plugin registry server.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    get requests() {
      return requests
    },
    close: () => closeServer(server)
  }
}

export async function startFakeOpenAiUpstream(): Promise<FakeOpenAiUpstream> {
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
