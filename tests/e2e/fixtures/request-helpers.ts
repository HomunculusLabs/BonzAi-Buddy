import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'

export interface RecordedRequest {
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
}

export function serializedRequestBodies(requests: RecordedRequest[]): string {
  return requests.map((request) => JSON.stringify(request.body)).join('\n')
}

export function extractLatestUserText(body: Record<string, unknown>): string {
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

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function writeJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>
): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

export function closeServer(server: Server): Promise<void> {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
