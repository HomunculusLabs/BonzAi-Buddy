import { spawn } from 'node:child_process'
import type {
  CommandRunResult,
  PluginCommandRunOptions
} from './plugin-installer-types'

export async function runCommandWithBoundedOutput(
  options: PluginCommandRunOptions
): Promise<CommandRunResult> {
  return new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk.toString(), options.outputLimitChars)
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk.toString(), options.outputLimitChars)
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut
      })
    })
  })
}

function appendBounded(current: string, addition: string, limit: number): string {
  const combined = `${current}${addition}`

  if (combined.length <= limit) {
    return combined
  }

  return combined.slice(combined.length - limit)
}
