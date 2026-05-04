import { expect, test } from '@playwright/test'
import { launchBonziApp } from './fixtures/app'

test('renders default companion route and admin route with tab switching', async () => {
  const session = await launchBonziApp({
    userDataDirPrefix: 'bonzi-e2e-web-admin-'
  })

  try {
    const { window } = session

    await expect(window.locator('.shell[data-app-ready="ready"]')).toBeVisible()
    await expect(window.locator('[data-admin-shell]')).toHaveCount(0)

    const adminUrl = await window.evaluate(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('bonziAdmin', '1')
      return url.toString()
    })

    await window.goto(adminUrl)

    await expect(window.locator('body[data-bonzi-surface="admin"]')).toBeVisible()
    await expect(window.locator('[data-admin-shell]')).toBeVisible()
    await expect(window.locator('[data-runtime-admin]')).toBeVisible()
    await expect(
      window.locator('[data-settings-tab="runtime"][aria-selected="true"]')
    ).toBeVisible()

    const pluginsTab = window.locator('[data-settings-tab="plugins"]')
    await pluginsTab.click()
    await expect(pluginsTab).toHaveAttribute('aria-selected', 'true')
    await expect(window.locator('#admin-pane-plugins')).toBeVisible()
    await expect(window.locator('#admin-pane-runtime')).toBeHidden()
  } finally {
    await session.close()
  }
})
