export interface AppWindowControlsOptions {
  minimizeButton: HTMLButtonElement
  closeButton: HTMLButtonElement
}

export interface AppWindowControls {
  dispose(): void
}

export function createAppWindowControls(
  options: AppWindowControlsOptions
): AppWindowControls {
  const handleMinimizeClick = (): void => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.minimize()
  }

  const handleCloseClick = (): void => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.close()
  }

  options.minimizeButton.addEventListener('click', handleMinimizeClick)
  options.closeButton.addEventListener('click', handleCloseClick)

  return {
    dispose: () => {
      options.minimizeButton.removeEventListener('click', handleMinimizeClick)
      options.closeButton.removeEventListener('click', handleCloseClick)
    }
  }
}
