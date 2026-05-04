export type SettingsTabId =
  | 'runtime'
  | 'general'
  | 'approvals'
  | 'character'
  | 'knowledge'
  | 'hermes'
  | 'routing'
  | 'plugins'

export interface SettingsTabsControllerOptions<T extends string = SettingsTabId> {
  rootEl: HTMLElement
  tabIds: readonly T[]
  defaultTabId: T
}

export interface SettingsTabsController<T extends string = SettingsTabId> {
  getActiveTab(): T
  setActiveTab(tabId: T, options?: { focus?: boolean }): void
  focusActiveTabSoon(isVisible: () => boolean): void
  dispose(): void
}

export function createSettingsTabsController<T extends string = SettingsTabId>(
  options: SettingsTabsControllerOptions<T>
): SettingsTabsController<T> {
  const tabButtons = Array.from(
    options.rootEl.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')
  ).filter((button) => isSettingsTabId(button.dataset.settingsTab, options.tabIds))
  const tabPanes = Array.from(
    options.rootEl.querySelectorAll<HTMLElement>('[data-settings-pane]')
  ).filter((pane) => isSettingsTabId(pane.dataset.settingsPane, options.tabIds))

  let activeSettingsTab = normalizeSettingsTabId(
    options.defaultTabId,
    options.tabIds,
    options.defaultTabId
  )

  const normalize = (value: string | undefined): T =>
    normalizeSettingsTabId(value, options.tabIds, options.defaultTabId)

  const setActiveTab = (
    tabId: T,
    tabOptions: { focus?: boolean } = {}
  ): void => {
    activeSettingsTab = normalize(tabId)

    for (const button of tabButtons) {
      const buttonTabId = normalize(button.dataset.settingsTab)
      const isSelected = buttonTabId === activeSettingsTab
      button.setAttribute('aria-selected', String(isSelected))
      button.tabIndex = isSelected ? 0 : -1

      if (isSelected && tabOptions.focus) {
        button.focus()
      }
    }

    for (const pane of tabPanes) {
      const paneTabId = normalize(pane.dataset.settingsPane)
      pane.hidden = paneTabId !== activeSettingsTab
    }
  }

  const focusActiveTabSoon = (isVisible: () => boolean): void => {
    window.requestAnimationFrame(() => {
      if (!isVisible()) {
        return
      }

      setActiveTab(activeSettingsTab, { focus: true })
    })
  }

  const handleSettingsTabClick = (event: MouseEvent): void => {
    const target = event.target

    if (!(target instanceof Element)) {
      return
    }

    const tabButton = target.closest<HTMLButtonElement>('[data-settings-tab]')

    if (!tabButton || !tabButtons.includes(tabButton)) {
      return
    }

    setActiveTab(normalize(tabButton.dataset.settingsTab), { focus: true })
  }

  const handleSettingsTabKeydown = (event: KeyboardEvent): void => {
    const target = event.target

    if (!(target instanceof HTMLButtonElement) || !tabButtons.includes(target)) {
      return
    }

    const currentIndex = tabButtons.indexOf(target)
    if (currentIndex < 0) {
      return
    }

    let nextIndex: number | null = null

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % tabButtons.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabButtons.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const nextButton = tabButtons[nextIndex]
    setActiveTab(normalize(nextButton.dataset.settingsTab), { focus: true })
  }

  setActiveTab(activeSettingsTab)
  options.rootEl.addEventListener('click', handleSettingsTabClick)
  options.rootEl.addEventListener('keydown', handleSettingsTabKeydown)

  return {
    getActiveTab: () => activeSettingsTab,
    setActiveTab,
    focusActiveTabSoon,
    dispose: () => {
      options.rootEl.removeEventListener('click', handleSettingsTabClick)
      options.rootEl.removeEventListener('keydown', handleSettingsTabKeydown)
    }
  }
}

function normalizeSettingsTabId<T extends string>(
  value: string | undefined,
  tabIds: readonly T[],
  fallback: T
): T {
  return isSettingsTabId(value, tabIds) ? value : fallback
}

function isSettingsTabId<T extends string>(
  value: string | undefined,
  tabIds: readonly T[]
): value is T {
  return typeof value === 'string' && tabIds.includes(value as T)
}
