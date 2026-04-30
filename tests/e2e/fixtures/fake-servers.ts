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
  urlForPath: (path: string) => string
  close: () => Promise<void>
}

export async function startFakeDiscordDomServer(): Promise<FakeDiscordDomServer> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.statusCode = 404
      response.end('Not found')
      return
    }

    const requestUrl = request.url ?? '/'

    if (requestUrl.startsWith('/channels/test/server/channel')) {
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

    if (requestUrl.startsWith('/channels/test/server/empty')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Fake Discord Empty Channel</title></head>
  <body>
    <main>
      <h1>#empty</h1>
      <section data-list-id="chat-messages" aria-label="Messages in empty"></section>
      <div role="textbox" contenteditable="true" aria-label="Message #empty"></div>
    </main>
  </body>
</html>`)
      return
    }

    if (requestUrl.startsWith('/channels/test/server/selector-drift')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Fake Discord Selector Drift</title></head>
  <body>
    <main>
      <h1>#selector-drift</h1>
      <section data-custom-list="unrecognized-list">
        <div data-custom-item="1">No supported Discord selectors here.</div>
      </section>
      <div role="textbox" contenteditable="true" aria-label="Message #selector-drift"></div>
    </main>
  </body>
</html>`)
      return
    }

    if (requestUrl.startsWith('/channels/test/server/no-composer')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Fake Discord No Composer</title></head>
  <body>
    <main>
      <h1>#no-composer</h1>
      <section data-list-id="chat-messages" aria-label="Messages in no-composer">
        <article role="article" id="chat-messages-3">
          <h3><span id="message-username-3">Charlie</span></h3>
          <div id="message-content-3">Messages exist but no composer.</div>
        </article>
      </section>
    </main>
  </body>
</html>`)
      return
    }

    if (requestUrl.startsWith('/channels/test/server/existing-composer')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Fake Discord Existing Composer</title></head>
  <body>
    <main>
      <h1>#existing-composer</h1>
      <section data-list-id="chat-messages" aria-label="Messages in existing-composer">
        <article role="article" id="chat-messages-4">
          <h3><span id="message-username-4">Dana</span></h3>
          <div id="message-content-4">Draft should not overwrite existing text.</div>
        </article>
      </section>
      <div role="textbox" contenteditable="true" aria-label="Message #existing-composer">Already typing here</div>
    </main>
  </body>
</html>`)
      return
    }

    if (requestUrl.startsWith('/login')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Discord Login</title></head>
  <body>
    <main>
      <h1>Welcome back!</h1>
      <form>
        <label>Email <input type="email" name="email" /></label>
        <label>Password <input type="password" name="password" /></label>
      </form>
    </main>
  </body>
</html>`)
      return
    }

    if (requestUrl.startsWith('/channels/@me')) {
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
<html>
  <head><title>Discord Home</title></head>
  <body>
    <main>
      <h1>Direct Messages</h1>
      <p>Select a conversation.</p>
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

  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    url: `${baseUrl}/channels/test/server/channel`,
    urlForPath: (path: string) => `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
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
