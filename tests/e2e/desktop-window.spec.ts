import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'
import { getRequiredBox } from './fixtures/dom'

test('drags after a speech bubble expires without stale bubble hit targets', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-drag-expiry-',
    env: {
      BONZI_BUBBLE_EXPIRY_MS: '500'
    }
  })

  try {
    const { window } = session
    const stage = window.locator('.stage-shell')
    const shell = window.locator('.shell')
    const bubbleContent = window.locator(
      '.bubble-entry--assistant .bubble-entry__content'
    )

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()

    await stage.dblclick()

    const commandInput = window.locator('#assistant-command')
    await commandInput.fill('hello click dismiss e2e')
    await commandInput.press('Enter')

    await expect(bubbleContent).toHaveText(
      'E2E assistant reply for: hello click dismiss e2e'
    )
    await expect(window.locator('.shell.shell--bubble-visible')).toBeVisible()

    await bubbleContent.click()
    await expect
      .poll(() =>
        shell.evaluate(
          (element) =>
            element.classList.contains('shell--bubble-visible') ||
            element.classList.contains('shell--bubble-dismissing')
        )
      )
      .toBe(false)
    await stage.dblclick()
    await commandInput.fill('hello expiry e2e')
    await commandInput.press('Enter')

    await expect(bubbleContent).toHaveText(
      'E2E assistant reply for: hello expiry e2e'
    )
    await expect(window.locator('.shell.shell--bubble-visible')).toBeVisible()

    const bubbleBox = await getRequiredBox(window.locator('.speech-bubble'))
    const stalePoint = {
      x: Math.round(bubbleBox.x + bubbleBox.width / 2),
      y: Math.round(bubbleBox.y + bubbleBox.height / 2)
    }

    await expect
      .poll(() =>
        shell.evaluate(
          (element) =>
            element.classList.contains('shell--bubble-visible') ||
            element.classList.contains('shell--bubble-dismissing')
        )
      )
      .toBe(false)
    const stalePointHitsBubble = await window.evaluate(({ x, y }) => {
      return Boolean(document.elementFromPoint(x, y)?.closest('.speech-bubble'))
    }, stalePoint)
    expect(stalePointHitsBubble).toBe(false)

    const stageBox = await getRequiredBox(stage)
    const start = {
      x: Math.round(stageBox.x + stageBox.width / 2),
      y: Math.round(stageBox.y + stageBox.height / 2)
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
    await session.close()
  }
})

// Manual transparent-window validation remains required on macOS: launch without
// BONZI_OPAQUE_WINDOW=1 and without BONZI_DISABLE_VRM=1, send a message, wait for
// bubble expiry, move across transparent stage space, then drag the visible avatar
// repeatedly to verify Electron click-through never strands the window.
