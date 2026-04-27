import { chmod, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { startFakePluginRegistry } from './fixtures/fake-servers'
import { readJsonFile } from './fixtures/json'

test('manages bundled optional plugins from settings catalog', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-plugins-'
  })

  try {
    const { window, userDataDir } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="plugins"]').click()

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
    await expect(installedContextRow.locator('.settings-badge')).toHaveText('Disabled')

    const persisted = await readJsonFile<{
      schemaVersion?: number
      plugins?: Record<string, { installed: boolean; enabled: boolean }>
    }>(join(userDataDir, 'bonzi-settings.json'))

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
    await session.close()
  }
})

test('migrates legacy curated plugin settings to V2 records', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-plugins-legacy-',
    prepareUserDataDir: async (userDataDir) => {
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
    }
  })

  try {
    const { window, userDataDir } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="plugins"]').click()

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

    const persisted = await readJsonFile<{
      schemaVersion?: number
      plugins?: Record<string, { installed: boolean; enabled: boolean }>
    }>(join(userDataDir, 'bonzi-settings.json'))

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
    await session.close()
  }
})

test('heals malformed V2 plugin settings records', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-plugins-malformed-',
    prepareUserDataDir: async (userDataDir) => {
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
    }
  })

  try {
    const { window, userDataDir } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="plugins"]').click()

    await expect(
      window.locator('[data-plugin-id="bonzi-context"][data-plugin-installed="true"]')
    ).toBeVisible()
    await expect(
      window.locator(
        '[data-plugin-id="bonzi-desktop-actions"][data-plugin-installed="true"]'
      )
    ).toBeVisible()

    const persisted = await readJsonFile<{
      schemaVersion?: number
      plugins?: Record<string, unknown>
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.plugins?.provider).toBeUndefined()
    expect(persisted.plugins?.['bad-plugin']).toBeUndefined()
    expect(persisted.plugins?.['bonzi-context']).toBeDefined()
    expect(persisted.plugins?.['bonzi-desktop-actions']).toBeDefined()
  } finally {
    await session.close()
  }
})

test('discovers plugins from registry endpoint via preload bridge', async () => {
  const registry = await startFakePluginRegistry()
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-plugin-discovery-',
    env: {
      BONZI_ELIZA_PLUGIN_REGISTRY_URL: `${registry.baseUrl}/plugins.json`
    }
  })

  try {
    const { window, userDataDir } = session
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

    const incompatibleDiscoverRow = window.locator(
      '[data-plugin-id="legacy-bot"][data-plugin-available="true"]'
    )
    await expect(incompatibleDiscoverRow).toBeVisible()
    await expect(
      incompatibleDiscoverRow.locator('[data-plugin-install="legacy-bot"]')
    ).toBeDisabled()

    const cache = await readJsonFile<{
      schemaVersion?: number
      entries?: unknown[]
    }>(join(userDataDir, 'eliza-plugin-registry-cache.v2.json'))

    expect(cache.schemaVersion).toBe(2)
    expect(Array.isArray(cache.entries)).toBe(true)
    expect(registry.requests).toBeGreaterThan(0)
  } finally {
    await session.close()
    await registry.close()
  }
})

test('confirms plugin install preview when approvals are disabled', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-plugin-install-',
    prepareUserDataDir: async (userDataDir) => {
      const fakeBunPath = join(userDataDir, 'fake-bun')

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

      return {
        BONZI_PLUGIN_WORKSPACE_DIR: join(userDataDir, 'plugin-workspace'),
        BONZI_BUN_PATH: fakeBunPath,
        BONZI_FAKE_BUN_LOG: join(userDataDir, 'fake-bun.log')
      }
    }
  })

  try {
    const { window, userDataDir } = session
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
    expect(preview.message).toContain(
      'Installing third-party plugins requires confirmation'
    )

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

    const fakeBunLog = await readFile(join(userDataDir, 'fake-bun.log'), 'utf8')
    expect(fakeBunLog).toContain(
      'add @bealers/plugin-mattermost@0.5.1 --ignore-scripts'
    )

    const persisted = await readJsonFile<{
      plugins?: Record<string, { installed?: boolean; packageName?: string }>
    }>(join(userDataDir, 'bonzi-settings.json'))
    expect(persisted.plugins?.['@bealers/plugin-mattermost']?.installed).toBe(true)
    expect(persisted.plugins?.['@bealers/plugin-mattermost']?.packageName).toBe(
      '@bealers/plugin-mattermost'
    )
  } finally {
    await session.close()
  }
})
