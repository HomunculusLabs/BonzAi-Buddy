import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  test,
  expect,
  _electron as electron,
  type Locator
} from '@playwright/test'

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

interface FakePluginRegistry {
  baseUrl: string
  requests: number
  close: () => Promise<void>
}

interface FakeDiscordDomServer {
  url: string
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

test('reads Discord Web DOM context and persists the action observation', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-discord-context-'))
  const discord = await startFakeDiscordDomServer()
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir,
    BONZI_E2E_DISCORD_URL: discord.url,
    BONZI_DISCORD_BROWSER_SHOW_FOR_LOGIN: '0'
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const response = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'discord context e2e' })
    )
    expect(response.actions).toHaveLength(1)
    expect(response.actions[0]?.type).toBe('discord-read-context')

    const execution = await window.evaluate((actionId) =>
      window.bonzi.assistant.executeAction({ actionId, confirmed: false }),
      response.actions[0]!.id
    )
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('Discord Web DOM context')
    expect(execution.message).toContain('Alice: Can Bonzi read this channel?')
    expect(execution.message).toContain('Bob: Yes, from the browser DOM.')
    expect(execution.message).toContain('no screenshots or OCR')

    const history = await window.evaluate(() => window.bonzi.assistant.getHistory())
    const serializedHistory = history.map((message) => message.content).join('\n')
    expect(serializedHistory).toContain('[Bonzi action observation: discord-read-context / completed]')
    expect(serializedHistory).toContain('Alice: Can Bonzi read this channel?')
  } finally {
    await app.close()
    await discord.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('types a Discord Web draft without sending it', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-discord-draft-'))
  const discord = await startFakeDiscordDomServer()
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir,
    BONZI_E2E_DISCORD_URL: discord.url,
    BONZI_DISCORD_BROWSER_SHOW_FOR_LOGIN: '0'
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const response = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'discord draft e2e' })
    )
    expect(response.actions).toHaveLength(1)
    expect(response.actions[0]?.type).toBe('discord-type-draft')

    const execution = await window.evaluate((actionId) =>
      window.bonzi.assistant.executeAction({ actionId, confirmed: false }),
      response.actions[0]!.id
    )
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('Typed a Discord Web draft')
    expect(execution.message).toContain('did not press Enter')
    expect(execution.message).toContain('did not send')
  } finally {
    await app.close()
    await discord.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('drags after a speech bubble expires without stale bubble hit targets', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-drag-expiry-'))
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_BUBBLE_EXPIRY_MS: '100',
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
    await window.locator('.stage-shell').dblclick()

    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('hello expiry e2e')
    await commandInput.press('Enter')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText('E2E assistant reply for: hello expiry e2e')
    await expect(window.locator('.shell.shell--bubble-visible')).toBeVisible()

    const bubbleBox = await window.locator('.speech-bubble').boundingBox()
    expect(bubbleBox).not.toBeNull()
    const stalePoint = {
      x: Math.round(bubbleBox!.x + bubbleBox!.width / 2),
      y: Math.round(bubbleBox!.y + bubbleBox!.height / 2)
    }

    await expect
      .poll(() =>
        window.locator('.shell').evaluate((shell) =>
          shell.classList.contains('shell--bubble-visible')
        )
      )
      .toBe(false)

    const stalePointHitsBubble = await window.evaluate(({ x, y }) => {
      return Boolean(document.elementFromPoint(x, y)?.closest('.speech-bubble'))
    }, stalePoint)
    expect(stalePointHitsBubble).toBe(false)

    const stageBox = await window.locator('.stage-shell').boundingBox()
    expect(stageBox).not.toBeNull()
    const start = {
      x: Math.round(stageBox!.x + stageBox!.width / 2),
      y: Math.round(stageBox!.y + stageBox!.height / 2)
    }
    const beforeBounds = await window.evaluate(() => window.bonzi.window.getBounds())
    expect(beforeBounds).not.toBeNull()

    await window.mouse.move(start.x, start.y)
    await window.mouse.down()
    await window.mouse.move(start.x + 36, start.y + 24, { steps: 4 })
    await window.mouse.up()

    await expect
      .poll(() => window.evaluate(() => window.bonzi.window.getBounds()))
      .not.toEqual(beforeBounds)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

// Manual transparent-window validation remains required on macOS: launch without
// BONZI_OPAQUE_WINDOW=1 and without BONZI_DISABLE_VRM=1, send a message, wait for
// bubble expiry, move across transparent stage space, then drag the visible avatar
// repeatedly to verify Electron click-through never strands the window.

test.fixme(
  'renders workflow progress + approval controls in renderer',
  async () => {
    // TODO: Add coverage once BONZI_E2E_MODE can emit workflow-run-updated events
    // and sendCommand responses with workflowRun snapshots.
  }
)

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
    await window.locator('.stage-shell').dblclick()
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

    const persisted = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      schemaVersion?: number
      plugins?: Record<string, { installed: boolean; enabled: boolean }>
    }

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.plugins?.['bonzi-context']).toMatchObject({
      installed: true,
      enabled: false
    })
    expect(persisted.plugins?.['bonzi-desktop-actions']).toMatchObject({
      installed: true,
      enabled: true
    })
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('toggles runtime action approvals with explicit disable confirmation', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-approvals-'))
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
    await expect.poll(() =>
      window.evaluate(() => window.bonzi.settings.getRuntimeApprovalSettings())
    ).toEqual({ approvalsEnabled: true })

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()

    const approvalToggle = window.locator('[data-approval-toggle]')
    await expect(approvalToggle).toBeChecked()

    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await approvalToggle.uncheck()
    await expect(approvalToggle).not.toBeChecked()

    const persistedDisabled = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as { approvalsEnabled?: boolean }

    expect(persistedDisabled.approvalsEnabled).toBe(false)
    await expect.poll(() =>
      window.evaluate(() =>
        window.bonzi.app
          .getShellState()
          .then((state) => state.assistant.approvals.approvalsEnabled)
      )
    ).toBe(false)

    await approvalToggle.check()
    await expect(approvalToggle).toBeChecked()

    const persistedEnabled = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as { approvalsEnabled?: boolean }

    expect(persistedEnabled.approvalsEnabled).toBe(true)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('auto-runs action cards when approvals are disabled', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-approval-label-'))
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
    await window.locator('.stage-shell').dblclick()

    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('show shell state e2e')
    await commandInput.press('Enter')

    await expect(window.locator('.action-chip')).toHaveCount(1)
    await expect(window.locator('[data-action-id]')).toHaveText('Run action')

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await window.locator('[data-approval-toggle]').uncheck()
    await expect(window.locator('[data-approval-toggle]')).not.toBeChecked()

    await commandInput.fill('show shell state again e2e')
    await commandInput.press('Enter')

    await expect(window.locator('.action-chip').last()).toContainText('completed')
    await expect(window.locator('[data-action-id]').last()).toHaveText('Completed')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('migrates legacy curated plugin settings to V2 records', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-plugins-legacy-'))
  await writeFile(
    join(userDataDir, 'bonzi-settings.json'),
    JSON.stringify(
      {
        plugins: {
          'bonzi-context': false
        },
        catalog: {
          installed: {
            'bonzi-context': true,
            'bonzi-desktop-actions': false
          }
        }
      },
      null,
      2
    )
  )

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
    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()

    const installedContextRow = window.locator(
      '[data-plugin-id="bonzi-context"][data-plugin-installed="true"]'
    )
    const availableDesktopActionsRow = window.locator(
      '[data-plugin-id="bonzi-desktop-actions"][data-plugin-available="true"]'
    )
    const installedDesktopActionsRow = window.locator(
      '[data-plugin-id="bonzi-desktop-actions"][data-plugin-installed="true"]'
    )

    await expect(installedContextRow).toBeVisible()
    await expect(
      installedContextRow.locator('[data-plugin-toggle="bonzi-context"]')
    ).not.toBeChecked()
    await expect(availableDesktopActionsRow).toBeVisible()
    await expect(installedDesktopActionsRow).toHaveCount(0)

    const persisted = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      schemaVersion?: number
      plugins?: Record<string, { installed: boolean; enabled: boolean }>
    }

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.plugins?.['bonzi-context']).toMatchObject({
      installed: true,
      enabled: false
    })
    expect(persisted.plugins?.['bonzi-desktop-actions']).toMatchObject({
      installed: false,
      enabled: false
    })
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('heals malformed V2 plugin settings records', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-plugins-malformed-'))
  await writeFile(
    join(userDataDir, 'bonzi-settings.json'),
    JSON.stringify(
      {
        schemaVersion: 2,
        plugins: {
          'bonzi-context': {
            installed: 'yes'
          },
          provider: {
            installed: false,
            enabled: false
          },
          'bad-plugin': null
        }
      },
      null,
      2
    )
  )

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
    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()

    await expect(
      window.locator('[data-plugin-id="bonzi-context"][data-plugin-installed="true"]')
    ).toBeVisible()
    await expect(
      window.locator(
        '[data-plugin-id="bonzi-desktop-actions"][data-plugin-installed="true"]'
      )
    ).toBeVisible()

    const persisted = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      schemaVersion?: number
      plugins?: Record<string, unknown>
    }

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.plugins?.provider).toBeUndefined()
    expect(persisted.plugins?.['bad-plugin']).toBeUndefined()
    expect(persisted.plugins?.['bonzi-context']).toBeDefined()
    expect(persisted.plugins?.['bonzi-desktop-actions']).toBeDefined()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('discovers plugins from registry endpoint via preload bridge', async () => {
  const registry = await startFakePluginRegistry()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-plugin-discovery-'))
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir,
    BONZI_ELIZA_PLUGIN_REGISTRY_URL: `${registry.baseUrl}/plugins.json`
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const discovered = await window.evaluate(async () => {
      return window.bonzi.plugins.discover({ forceRefresh: true })
    })

    const registryWeather = discovered.availablePlugins.find(
      (plugin) => plugin.id === 'weather'
    )
    expect(registryWeather).toBeDefined()
    expect(registryWeather?.packageName).toBe('@elizaos/plugin-weather')

    const incompatibleLegacy = discovered.availablePlugins.find(
      (plugin) => plugin.id === 'legacy-bot'
    )
    expect(incompatibleLegacy?.lifecycleStatus).toBe('incompatible')
    expect(incompatibleLegacy?.warnings ?? []).toContain(
      'Registry marked this plugin as incompatible.'
    )

    const generatedMattermost = discovered.availablePlugins.find(
      (plugin) => plugin.id === '@bealers/plugin-mattermost'
    )
    expect(generatedMattermost).toBeDefined()
    expect(generatedMattermost?.packageName).toBe('@bealers/plugin-mattermost')
    expect(generatedMattermost?.version).toBe('0.5.1')
    expect(generatedMattermost?.description).toBe(
      'Mattermost client plugin for ElizaOS - enables AI agent integration with Mattermost chat platforms'
    )
    expect(generatedMattermost?.lifecycleStatus).toBe('available')
    expect(generatedMattermost?.warnings ?? []).not.toContain(
      'Registry marked this plugin as incompatible.'
    )
    expect(generatedMattermost?.warnings ?? []).not.toContain(
      'Registry entry did not include a description.'
    )

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="plugins"]').click()
    const weatherDiscoverRow = window.locator(
      '[data-plugin-id="weather"][data-plugin-available="true"]'
    )
    await expect(weatherDiscoverRow).toBeVisible()
    await expect(
      weatherDiscoverRow.locator('[data-plugin-install="weather"]')
    ).toBeVisible()

    const cache = JSON.parse(
      await readFile(
        join(userDataDir, 'eliza-plugin-registry-cache.v2.json'),
        'utf8'
      )
    ) as {
      schemaVersion?: number
      entries?: unknown[]
    }

    expect(cache.schemaVersion).toBe(2)
    expect(Array.isArray(cache.entries)).toBe(true)
    expect(registry.requests).toBeGreaterThan(0)
  } finally {
    await app.close()
    await registry.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('confirms plugin install preview when approvals are disabled', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-plugin-install-'))
  const workspaceDir = join(userDataDir, 'plugin-workspace')
  const fakeBunPath = join(userDataDir, 'fake-bun')
  const fakeBunLogPath = join(userDataDir, 'fake-bun.log')

  await writeFile(
    join(userDataDir, 'bonzi-settings.json'),
    JSON.stringify(
      {
        schemaVersion: 2,
        plugins: {},
        approvalsEnabled: false
      },
      null,
      2
    )
  )
  await writeFile(
    fakeBunPath,
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BONZI_FAKE_BUN_LOG"\nexit 0\n'
  )
  await chmod(fakeBunPath, 0o755)

  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir,
    BONZI_PLUGIN_WORKSPACE_DIR: workspaceDir,
    BONZI_BUN_PATH: fakeBunPath,
    BONZI_FAKE_BUN_LOG: fakeBunLogPath
  }
  delete env.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js')],
    env
  })

  try {
    const window = await app.firstWindow()
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const preview = await window.evaluate(async () => {
      return window.bonzi.plugins.install({
        id: '@bealers/plugin-mattermost',
        pluginId: '@bealers/plugin-mattermost',
        packageName: '@bealers/plugin-mattermost',
        versionRange: '0.5.1',
        confirmed: false
      })
    })

    expect(preview.ok).toBe(false)
    expect(preview.confirmationRequired).toBe(true)
    expect(preview.message).toContain('Installing third-party plugins requires confirmation')

    const installResult = await window.evaluate(async (operationId) => {
      return window.bonzi.plugins.install({
        id: '@bealers/plugin-mattermost',
        pluginId: '@bealers/plugin-mattermost',
        packageName: '@bealers/plugin-mattermost',
        versionRange: '0.5.1',
        confirmed: true,
        confirmationOperationId: operationId
      })
    }, preview.operation.operationId)

    expect(installResult.ok).toBe(true)
    expect(installResult.confirmationRequired).toBe(false)
    expect(installResult.message).toContain('Installed @bealers/plugin-mattermost')

    const fakeBunLog = await readFile(fakeBunLogPath, 'utf8')
    expect(fakeBunLog).toContain('add @bealers/plugin-mattermost@0.5.1 --ignore-scripts')

    const persisted = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      plugins?: Record<string, { installed?: boolean; packageName?: string }>
    }
    expect(persisted.plugins?.['@bealers/plugin-mattermost']?.installed).toBe(true)
    expect(persisted.plugins?.['@bealers/plugin-mattermost']?.packageName).toBe(
      '@bealers/plugin-mattermost'
    )
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('saves custom Eliza character JSON, reloads runtime, and rejects malformed drafts', async () => {
  const upstream = await startFakeOpenAiUpstream()
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-e2e-character-'))
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

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()

    const characterSection = window.locator('[data-character-settings]')
    await expect(characterSection).toBeVisible()
    await expect(characterSection.locator('[data-character-name]')).toHaveValue(
      'Bonzi'
    )
    await expect(characterSection.locator('[data-character-system]')).toHaveValue(
      /You are Bonzi/
    )
    await expect(characterSection.locator('[data-character-bio]')).toHaveValue(
      /desktop companion assistant/
    )
    await expect(characterSection.locator('[data-character-message-examples]')).toHaveValue(
      /Can you search the web for cute jellyfish facts/
    )
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

    const persistedAfterSave = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      schemaVersion?: number
      character?: { enabled?: boolean; characterJson?: string }
    }

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

    await applyRuntimeChanges.click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Runtime reload complete.'
    )
    await expect(applyRuntimeChanges).toBeHidden()

    upstream.chatRequests.length = 0
    const response = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'character marker e2e' })
    )
    expect(response.ok).toBe(true)
    await expect
      .poll(() => serializedRequestBodies(upstream.chatRequests))
      .toContain(marker)

    await setTextareaValue(characterSection.locator('[data-character-json]'), '{')
    await characterSection.locator('[data-character-save]').click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Failed to save Eliza character settings'
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue('{')

    const persistedAfterInvalidSave = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      character?: { enabled?: boolean; characterJson?: string }
    }

    expect(persistedAfterInvalidSave.character?.enabled).toBe(true)
    expect(persistedAfterInvalidSave.character?.characterJson).toBe(
      persistedAfterSave.character?.characterJson
    )

    await characterSection.locator('[data-character-reset]').click()
    await expect(window.locator('[data-settings-status]')).toContainText(
      'Saved Eliza character settings'
    )
    await expect(characterSection.locator('[data-character-name]')).toHaveValue(
      'Bonzi'
    )
    await expect(characterSection.locator('[data-character-json]')).toHaveValue(
      /\"name\": \"Bonzi\"/
    )

    const persistedAfterReset = JSON.parse(
      await readFile(join(userDataDir, 'bonzi-settings.json'), 'utf8')
    ) as {
      character?: { enabled?: boolean; characterJson?: string }
    }

    expect(persistedAfterReset.character?.enabled).toBe(false)
    expect(persistedAfterReset.character?.characterJson).toBe('{}')
  } finally {
    await app.close()
    await upstream.close()
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

async function startFakeDiscordDomServer(): Promise<FakeDiscordDomServer> {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/channels/test/server/channel')) {
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

async function startFakePluginRegistry(): Promise<FakePluginRegistry> {
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

async function setTextareaValue(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement
    textarea.value = nextValue
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
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
