import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { startFakeDiscordDomServer } from './fixtures/fake-servers'
import { readJsonFile } from './fixtures/json'

async function runDiscordContextAction(url: string) {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-discord-context-',
    env: {
      BONZI_E2E_DISCORD_URL: url,
      BONZI_DISCORD_BROWSER_SHOW_FOR_LOGIN: '0'
    }
  })

  const { window } = session
  await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

  const response = await window.evaluate(() =>
    window.bonzi.assistant.sendCommand({ command: 'discord context e2e' })
  )
  expect(response.actions).toHaveLength(1)
  expect(response.actions[0]?.type).toBe('discord-read-context')

  const execution = await window.evaluate(
    (actionId) => window.bonzi.assistant.executeAction({ actionId, confirmed: false }),
    response.actions[0]!.id
  )

  return { session, window, execution }
}

async function runDiscordDraftAction(url: string) {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-discord-draft-',
    env: {
      BONZI_E2E_DISCORD_URL: url,
      BONZI_DISCORD_BROWSER_SHOW_FOR_LOGIN: '0'
    }
  })

  const { window } = session
  await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

  const response = await window.evaluate(() =>
    window.bonzi.assistant.sendCommand({ command: 'discord draft e2e' })
  )
  expect(response.actions).toHaveLength(1)
  expect(response.actions[0]?.type).toBe('discord-type-draft')

  const execution = await window.evaluate(
    (actionId) => window.bonzi.assistant.executeAction({ actionId, confirmed: false }),
    response.actions[0]!.id
  )

  return { session, execution }
}

test('reads Discord Web DOM context and persists the action observation', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordContextAction(discord.url)
    session = run.session
    const { window, execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('Discord Web DOM context')
    expect(execution.message).toContain('Alice: Can Bonzi read this channel?')
    expect(execution.message).toContain('Bob: Yes, from the browser DOM.')
    expect(execution.message).toContain('no screenshots or OCR')

    const history = await window.evaluate(() => window.bonzi.assistant.getHistory())
    const serializedHistory = history.map((message) => message.content).join('\n')
    expect(serializedHistory).toContain(
      '[Bonzi action observation: discord-read-context / completed]'
    )
    expect(serializedHistory).toContain('Alice: Can Bonzi read this channel?')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('types a Discord Web draft without sending it', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordDraftAction(discord.url)
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('Typed a Discord Web draft')
    expect(execution.message).toContain('did not press Enter')
    expect(execution.message).toContain('did not send')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('reports login-required context state on Discord login page', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordContextAction(discord.urlForPath('/login'))
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('Login required in Bonzi\'s Discord Web browser session.')
    expect(execution.message).toContain('Readiness: login_required')
    expect(execution.message).toContain('Diagnostics:')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('reports wrong-page context state for non-channel Discord pages', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordContextAction(discord.urlForPath('/channels/@me'))
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain(
      'Discord Web is open, but not on a specific channel or DM.'
    )
    expect(execution.message).toContain('Readiness: wrong_page')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('reports empty-messages context state for empty channels', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordContextAction(
      discord.urlForPath('/channels/test/server/empty')
    )
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain('No visible chat messages were found in this channel.')
    expect(execution.message).toContain('Readiness: empty_messages')
    expect(execution.message).toContain('No messages were read or sent.')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('reports selector-drift context state when supported message selectors fail', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordContextAction(
      discord.urlForPath('/channels/test/server/selector-drift')
    )
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain(
      'DOM selectors did not find the message list'
    )
    expect(execution.message).toContain('Readiness: selector_drift')
    expect(execution.message).toContain('messageSelectors=none')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('reports missing composer for draft typing when composer is unavailable', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordDraftAction(
      discord.urlForPath('/channels/test/server/no-composer')
    )
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain(
      'Discord channel loaded, but Bonzi could not find the message composer.'
    )
    expect(execution.message).toContain('No Discord message was sent.')
    expect(execution.message).toContain('composer=false')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('does not overwrite existing composer text when typing a draft', async () => {
  const discord = await startFakeDiscordDomServer()
  let session: { close: () => Promise<void> } | null = null

  try {
    const run = await runDiscordDraftAction(
      discord.urlForPath('/channels/test/server/existing-composer')
    )
    session = run.session
    const { execution } = run
    expect(execution.ok).toBe(true)
    expect(execution.message).toContain(
      'Discord composer already contains text, so Bonzi did not overwrite it.'
    )
    expect(execution.message).toContain('Existing composer text: Already typing here')
  } finally {
    if (session) {
      await session.close()
    }
    await discord.close()
  }
})

test('continues a multi-step workflow after an external action completes', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-multi-step-manual-'
  })

  try {
    const { window } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.evaluate(() => {
      const recordedEvents: unknown[] = []
      ;(window as Window & { __bonziE2eEvents?: unknown[] }).__bonziE2eEvents =
        recordedEvents
      window.bonzi.assistant.onEvent((event) => {
        recordedEvents.push(event)
      })
    })
    await window.evaluate(() =>
      window.bonzi.settings.updateRuntimeApprovalSettings({
        continuation: { postActionDelayMs: 25 }
      })
    )

    await window.locator('.stage-shell').dblclick()
    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('multi step e2e')
    await commandInput.press('Enter')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText('Starting multi-step e2e workflow.')

    const firstCard = window.locator('[data-action-card]').first()
    await expect(firstCard).toHaveAttribute('data-action-status', 'pending')
    await expect(firstCard).not.toHaveAttribute('data-workflow-run-id', '')
    await expect(firstCard).not.toHaveAttribute('data-workflow-step-id', '')
    await expect(window.locator('[data-action-id]').first()).toHaveText('Run action')
    await expect(window.locator('.workflow-card__run-status')).toHaveText(
      'awaiting external action'
    )
    await expect(window.locator('.workflow-card__summary')).toContainText(
      'Waiting for Bonzi action card to run'
    )

    const firstActionId = await window
      .locator('[data-action-id]')
      .first()
      .getAttribute('data-action-id')
    expect(firstActionId).toBeTruthy()

    const firstExecution = await window.evaluate(
      (actionId) =>
        window.bonzi.assistant.executeAction({ actionId: actionId!, confirmed: true }),
      firstActionId
    )
    expect(firstExecution.ok).toBe(true)
    expect(firstExecution.action?.status).toBe('completed')
    expect(firstExecution.continuationScheduled).toBe(true)
    expect(firstExecution.workflowRun?.status).toBe('running')
    await expect(window.locator('.workflow-card__summary')).toContainText(
      'steps finished; continuing workflow'
    )
    await expect(window.locator('.workflow-card__summary')).not.toContainText(
      'steps completed'
    )
    await expect(window.locator('.workflow-card__current')).toContainText(
      'Bonzi is preparing the next step'
    )

    await expect
      .poll(() =>
        window.evaluate(
          () =>
            ((window as Window & {
              __bonziE2eEvents?: Array<{
                type?: string
                turn?: { message?: { content?: string } }
              }>
            }).__bonziE2eEvents ?? [])
              .filter((event) => event.type === 'assistant-turn-created')
              .map((event) => event.turn?.message?.content)
        )
      )
      .toContain('Observed shell state; next step is copying the asset path.')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText('Observed shell state; next step is copying the asset path.')

    const secondCard = window.locator('[data-action-card]').last()
    await expect(secondCard).toContainText('Copy VRM asset path')
    await expect(secondCard).toHaveAttribute('data-action-status', 'pending')
    await expect(secondCard).not.toHaveAttribute('data-workflow-run-id', '')
    await expect(secondCard).not.toHaveAttribute('data-workflow-step-id', '')

    const secondActionId = await window
      .locator('[data-action-id]')
      .last()
      .getAttribute('data-action-id')
    expect(secondActionId).toBeTruthy()

    const secondExecution = await window.evaluate(
      (actionId) =>
        window.bonzi.assistant.executeAction({ actionId: actionId!, confirmed: true }),
      secondActionId
    )
    expect(secondExecution.ok).toBe(true)
    expect(secondExecution.action?.status).toBe('completed')
    expect(secondExecution.continuationScheduled).toBe(true)

    await expect
      .poll(() =>
        window.evaluate(
          () =>
            ((window as Window & {
              __bonziE2eEvents?: Array<{
                type?: string
                turn?: { message?: { content?: string } }
              }>
            }).__bonziE2eEvents ?? [])
              .filter((event) => event.type === 'assistant-turn-created')
              .map((event) => event.turn?.message?.content)
        )
      )
      .toContain('Multi-step e2e complete.')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText('Multi-step e2e complete.')

    const finalRun = await window.evaluate(async () => {
      const runs = await window.bonzi.assistant.getWorkflowRuns()
      return runs.find((run) => run.userCommand === 'multi step e2e') ?? null
    })
    expect(finalRun?.status).toBe('completed')
    expect(finalRun?.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed'
    ])

    const eventSummary = await window.evaluate(
      ({ firstActionId, secondActionId }) => {
        const events =
          (window as Window & {
            __bonziE2eEvents?: Array<{
              type?: string
              action?: {
                id?: string
                status?: string
                workflowRunId?: string
                workflowStepId?: string
              }
              turn?: {
                actions?: Array<{ workflowRunId?: string; workflowStepId?: string }>
              }
            }>
          }).__bonziE2eEvents ?? []

        return {
          firstActionStatuses: events
            .filter((event) => event.type === 'assistant-action-updated')
            .map((event) => event.action)
            .filter((action) => action?.id === firstActionId)
            .map((action) => action?.status),
          secondActionStatuses: events
            .filter((event) => event.type === 'assistant-action-updated')
            .map((event) => event.action)
            .filter((action) => action?.id === secondActionId)
            .map((action) => action?.status),
          allTurnActionsCorrelated: events
            .filter((event) => event.type === 'assistant-turn-created')
            .flatMap((event) => event.turn?.actions ?? [])
            .every((action) => Boolean(action.workflowRunId && action.workflowStepId))
        }
      },
      { firstActionId, secondActionId }
    )
    expect(eventSummary.firstActionStatuses).toContain('running')
    expect(eventSummary.firstActionStatuses).toContain('completed')
    expect(eventSummary.secondActionStatuses).toContain('running')
    expect(eventSummary.secondActionStatuses).toContain('completed')
    expect(eventSummary.allTurnActionsCorrelated).toBe(true)

    const history = await window.evaluate(() => window.bonzi.assistant.getHistory())
    const serializedHistory = history.map((message) => message.content).join('\n')
    expect(serializedHistory).toContain(
      '[Bonzi action observation: report-shell-state / completed]'
    )
    expect(serializedHistory).toContain(
      '[Bonzi action observation: copy-vrm-asset-path / completed]'
    )
    expect(serializedHistory).not.toContain('Continue the current Bonzi workflow')
  } finally {
    await session.close()
  }
})

test('completes the multi-step workflow autonomously when approvals are disabled', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-multi-step-auto-',
    prepareUserDataDir: async (userDataDir) => {
      await writeFile(
        join(userDataDir, 'bonzi-settings.json'),
        JSON.stringify(
          {
            schemaVersion: 2,
            plugins: {},
            approvalsEnabled: false,
            continuation: {
              maxSteps: 6,
              maxRuntimeMs: 120_000,
              postActionDelayMs: 25
            }
          },
          null,
          2
        )
      )
    }
  })

  try {
    const { window } = session
    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.evaluate(() => {
      const recordedEvents: unknown[] = []
      ;(window as Window & { __bonziE2eEvents?: unknown[] }).__bonziE2eEvents =
        recordedEvents
      window.bonzi.assistant.onEvent((event) => {
        recordedEvents.push(event)
      })
    })

    await window.locator('.stage-shell').dblclick()
    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('multi step e2e')
    await commandInput.press('Enter')

    await expect
      .poll(() =>
        window.evaluate(async () => {
          const runs = await window.bonzi.assistant.getWorkflowRuns()
          const run = runs.find((candidate) => candidate.userCommand === 'multi step e2e')
          return run?.status
        })
      )
      .toBe('completed')

    await expect(
      window.locator('.bubble-entry--assistant .bubble-entry__content')
    ).toHaveText('Multi-step e2e complete.')
    await expect(
      window.locator('[data-action-card][data-action-status="pending"]')
    ).toHaveCount(0)
    await expect(
      window.locator('[data-action-card][data-action-status="needs_confirmation"]')
    ).toHaveCount(0)

    const run = await window.evaluate(async () => {
      const runs = await window.bonzi.assistant.getWorkflowRuns()
      return runs.find((candidate) => candidate.userCommand === 'multi step e2e') ?? null
    })
    expect(run?.steps).toHaveLength(2)
    expect(run?.steps.map((step) => step.status)).toEqual(['completed', 'completed'])
    expect(
      run?.steps.every((step) => step.externalActionId && step.continuationId)
    ).toBe(true)

    const eventSummary = await window.evaluate(() => {
      const events =
        (window as Window & {
          __bonziE2eEvents?: Array<{
            type?: string
            action?: { status?: string }
            turn?: {
              message?: { content?: string }
              actions?: Array<{ status?: string }>
            }
          }>
        }).__bonziE2eEvents ?? []
      return {
        turnMessages: events
          .filter((event) => event.type === 'assistant-turn-created')
          .map((event) => event.turn?.message?.content),
        actionStatuses: events
          .filter((event) => event.type === 'assistant-action-updated')
          .map((event) => event.action?.status),
        turnActionStatuses: events
          .filter((event) => event.type === 'assistant-turn-created')
          .flatMap((event) => event.turn?.actions ?? [])
          .map((action) => action.status)
      }
    })
    expect(eventSummary.turnMessages).toEqual([
      'Observed shell state; next step is copying the asset path.',
      'Multi-step e2e complete.'
    ])
    expect(eventSummary.actionStatuses).toContain('running')
    expect(eventSummary.actionStatuses).toContain('completed')
    expect(eventSummary.turnActionStatuses).not.toContain('pending')

    const history = await window.evaluate(() => window.bonzi.assistant.getHistory())
    const serializedHistory = history.map((message) => message.content).join('\n')
    expect(serializedHistory).toContain(
      '[Bonzi action observation: report-shell-state / completed]'
    )
    expect(serializedHistory).toContain(
      '[Bonzi action observation: copy-vrm-asset-path / completed]'
    )
    expect(serializedHistory).not.toContain('Continue the current Bonzi workflow')
  } finally {
    await session.close()
  }
})

test('toggles runtime action approvals with explicit disable confirmation', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-approvals-'
  })

  try {
    const { window, userDataDir } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await expect
      .poll(() =>
        window.evaluate(() => window.bonzi.settings.getRuntimeApprovalSettings())
      )
      .toMatchObject({
        approvalsEnabled: true,
        continuation: {
          maxSteps: 6,
          maxRuntimeMs: 120_000,
          postActionDelayMs: 750
        }
      })

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="approvals"]').click()

    const approvalToggle = window.locator('[data-approval-toggle]')
    await expect(approvalToggle).toBeChecked()

    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await approvalToggle.uncheck()
    await expect(approvalToggle).not.toBeChecked()

    const persistedDisabled = await readJsonFile<{ approvalsEnabled?: boolean }>(
      join(userDataDir, 'bonzi-settings.json')
    )

    expect(persistedDisabled.approvalsEnabled).toBe(false)
    await expect
      .poll(() =>
        window.evaluate(() =>
          window.bonzi.app
            .getShellState()
            .then((state) => state.assistant.approvals.approvalsEnabled)
        )
      )
      .toBe(false)

    await approvalToggle.check()
    await expect(approvalToggle).toBeChecked()

    const persistedEnabled = await readJsonFile<{ approvalsEnabled?: boolean }>(
      join(userDataDir, 'bonzi-settings.json')
    )

    expect(persistedEnabled.approvalsEnabled).toBe(true)
  } finally {
    await session.close()
  }
})

test('auto-runs action cards when approvals are disabled', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-approval-label-'
  })

  try {
    const { window } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await window.locator('.stage-shell').dblclick()

    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('show shell state e2e')
    await commandInput.press('Enter')

    await expect(window.locator('.action-chip')).toHaveCount(1)
    await expect(window.locator('[data-action-id]')).toHaveText('Run action')

    await window.locator('.stage-shell').dblclick()
    await window.locator('[data-action="settings"]').click()
    await window.locator('[data-settings-tab="approvals"]').click()
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
    await session.close()
  }
})
