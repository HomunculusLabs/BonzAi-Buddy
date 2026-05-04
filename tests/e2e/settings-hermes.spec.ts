import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { setTextareaValue } from './fixtures/dom'
import { readJsonFile } from './fixtures/json'

test('renders and saves Hermes secondary runtime settings with health checks', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-hermes-settings-'
  })

  try {
    const { window, userDataDir } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const shellState = await window.evaluate(() => window.bonzi.app.getShellState())
    expect(shellState.assistant.runtime.backend).toBe('eliza')
    expect(shellState.assistant.secondaryRuntimes?.hermes?.status).toMatchObject({
      backend: 'hermes',
      role: 'secondary',
      persistence: 'none'
    })

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="hermes"]').click()

    const hermesSection = window.locator('[data-hermes-settings]')
    await expect(hermesSection).toContainText('Hermes Model & Auth/Profile')
    await expect(hermesSection).toContainText('secondary runtime')
    await expect(hermesSection.locator('[data-hermes-cli-path]')).toHaveValue('hermes')

    await hermesSection.locator('[data-hermes-cli-path]').fill('/usr/local/bin/hermes-e2e')
    await hermesSection.locator('[data-hermes-cwd]').fill(userDataDir)
    await hermesSection.locator('[data-hermes-model]').fill('e2e-hermes-model')
    await hermesSection.locator('[data-hermes-provider]').fill('e2e-provider')
    await hermesSection.locator('[data-hermes-timeout]').fill('45678')
    await setTextareaValue(
      hermesSection.locator('[data-hermes-system-prompt]'),
      'E2E Hermes system prompt'
    )
    await hermesSection.locator('[data-hermes-gateway-enabled]').uncheck()
    await hermesSection.locator('[data-hermes-gateway-url]').fill('http://127.0.0.1:9876/v1')
    await hermesSection.locator('[data-hermes-gateway-key]').fill('e2e-gateway-key')
    await hermesSection.locator('[data-hermes-gateway-host]').fill('127.0.0.1')
    await hermesSection.locator('[data-hermes-gateway-port]').fill('9876')

    const savedRuntime = await window.evaluate((cwd) =>
      window.bonzi.settings.updateHermesRuntimeSettings({
        cliPath: '/usr/local/bin/hermes-e2e',
        cwd,
        model: 'e2e-hermes-model',
        providerOverride: 'e2e-provider',
        timeoutMs: 45678,
        systemPrompt: 'E2E Hermes system prompt',
        gateway: {
          enabled: false,
          baseUrl: 'http://127.0.0.1:9876/v1',
          apiKey: 'e2e-gateway-key',
          host: '127.0.0.1',
          port: 9876
        }
      }),
      userDataDir
    )
    expect(savedRuntime.settings.cliPath).toBe('/usr/local/bin/hermes-e2e')

    const persisted = await readJsonFile<{
      schemaVersion?: number
      hermes?: {
        cliPath?: string
        cwd?: string
        model?: string
        providerOverride?: string
        timeoutMs?: number
        systemPrompt?: string
        gateway?: {
          enabled?: boolean
          baseUrl?: string
          apiKey?: string
          host?: string
          port?: number
        }
      }
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.hermes?.cliPath).toBe('/usr/local/bin/hermes-e2e')
    expect(persisted.hermes?.cwd).toBe(userDataDir)
    expect(persisted.hermes?.model).toBe('e2e-hermes-model')
    expect(persisted.hermes?.providerOverride).toBe('e2e-provider')
    expect(persisted.hermes?.timeoutMs).toBe(45678)
    expect(persisted.hermes?.systemPrompt).toBe('E2E Hermes system prompt')
    expect(persisted.hermes?.gateway).toMatchObject({
      enabled: false,
      baseUrl: 'http://127.0.0.1:9876/v1',
      apiKey: 'e2e-gateway-key',
      host: '127.0.0.1',
      port: 9876
    })

    await hermesSection.locator('[data-hermes-health="status"]').click()
    await expect(hermesSection.locator('[data-hermes-health-result]')).toContainText(
      'Hermes status check skipped in e2e mode'
    )

    await hermesSection.locator('[data-hermes-health="cron"]').click()
    await expect(hermesSection.locator('[data-hermes-health-result]')).toContainText(
      'Hermes cron check skipped in e2e mode'
    )

    await hermesSection.locator('[data-hermes-health="gateway"]').click()
    await expect(hermesSection.locator('[data-hermes-health-result]')).toContainText(
      'Hermes API server is disabled'
    )
  } finally {
    await session.close()
  }
})
