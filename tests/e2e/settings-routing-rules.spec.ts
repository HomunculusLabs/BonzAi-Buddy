import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { readJsonFile } from './fixtures/json'

test('saves routing rules and routes matching grow-room commands to Hermes', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-routing-rules-'
  })

  try {
    const { window, userDataDir } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="routing"]').click()
    await expect(window.locator('[data-routing-settings]')).toContainText('Routing rules')

    const response = await window.evaluate(() =>
      window.bonzi.settings.updateRuntimeRoutingSettings({
        enabled: true,
        rules: [
          {
            id: 'grow-room-hermes-e2e',
            enabled: true,
            name: 'Grow room questions consult Hermes',
            priority: 100,
            match: {
              kind: 'keyword',
              keywords: ['grow room', 'vpd'],
              mode: 'any',
              caseSensitive: false
            },
            target: {
              actionType: 'hermes-run',
              params: {
                prompt: 'Read-only grow-room check for Eliza. User command: {{command}}. Matched: {{keyword}}.'
              }
            },
            stopOnMatch: true
          }
        ]
      })
    )

    expect(response.warnings).toEqual([])
    expect(response.settings.rules[0]?.id).toBe('grow-room-hermes-e2e')

    const persisted = await readJsonFile<{
      schemaVersion?: number
      routing?: {
        enabled?: boolean
        rules?: Array<{ id?: string; target?: { actionType?: string } }>
      }
    }>(join(userDataDir, 'bonzi-settings.json'))

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.routing?.enabled).toBe(true)
    expect(persisted.routing?.rules?.[0]?.id).toBe('grow-room-hermes-e2e')
    expect(persisted.routing?.rules?.[0]?.target?.actionType).toBe('hermes-run')

    const routed = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'How is the grow room doing?' })
    )

    expect(routed.ok).toBe(true)
    expect(routed.actions).toHaveLength(1)
    expect(routed.actions[0]?.type).toBe('hermes-run')
    expect(routed.actions[0]?.description).toContain('Matched routing rule')
    expect(routed.actions[0]?.params?.prompt).toContain('How is the grow room doing?')
    expect(routed.actions[0]?.params?.prompt).toContain('grow room')

    const notRouted = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'plain e2e no routing match' })
    )

    expect(notRouted.ok).toBe(true)
    expect(notRouted.actions).toHaveLength(0)
  } finally {
    await session.close()
  }
})

test('invalid routing regex warns and does not break command handling', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-routing-invalid-'
  })

  try {
    const { window } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    const response = await window.evaluate(() =>
      window.bonzi.settings.updateRuntimeRoutingSettings({
        enabled: true,
        rules: [
          {
            id: 'bad-regex-e2e',
            enabled: true,
            name: 'Bad regex',
            priority: 1,
            match: {
              kind: 'regex',
              pattern: '[',
              caseSensitive: false
            },
            target: {
              actionType: 'hermes-run',
              params: {
                prompt: 'Should not run: {{command}}'
              }
            },
            stopOnMatch: true
          }
        ]
      })
    )

    expect(response.warnings.join('\n')).toContain('invalid regex')

    const commandResponse = await window.evaluate(() =>
      window.bonzi.assistant.sendCommand({ command: 'this should not explode' })
    )

    expect(commandResponse.ok).toBe(true)
    expect(commandResponse.actions).toHaveLength(0)
  } finally {
    await session.close()
  }
})
