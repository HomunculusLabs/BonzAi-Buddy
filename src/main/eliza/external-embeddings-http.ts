import type {
  IncomingMessage,
  Server,
  ServerResponse
} from 'node:http'

const MAX_REQUEST_BODY_BYTES = 1_000_000

export interface LoopbackListenConfig {
  bindHost: '127.0.0.1'
  port: number
}

export class RequestBodyTooLargeError extends Error {
  constructor(limit = MAX_REQUEST_BODY_BYTES) {
    super(`Request body exceeded ${limit} bytes.`)
    this.name = 'RequestBodyTooLargeError'
  }
}

export async function readJsonRequestBody(
  request: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length

    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError(MAX_REQUEST_BODY_BYTES)
    }

    chunks.push(buffer)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
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

export function writeOpenAiStyleError(
  response: ServerResponse,
  status: number,
  message: string,
  code: string
): void {
  writeJson(response, status, {
    error: {
      message,
      type: 'invalid_request_error',
      code
    }
  })
}

export async function listenOnLoopback(
  server: Server,
  config: LoopbackListenConfig
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(
        new Error(
          `External embeddings service failed to bind ${config.bindHost}:${config.port}: ${error.message}`
        )
      )
    }

    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(config.port, config.bindHost)
  })
}
