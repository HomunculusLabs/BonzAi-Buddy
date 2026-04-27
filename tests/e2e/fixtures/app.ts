import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

export interface LaunchBonziAppOptions {
  userDataDirPrefix?: string
  env?: Record<string, string>
  prepareUserDataDir?: (
    userDataDir: string
  ) => Promise<Record<string, string> | void>
}

export interface LaunchedBonziApp {
  app: ElectronApplication
  window: Page
  userDataDir: string
  close: () => Promise<void>
}

export async function launchBonziApp(
  options: LaunchBonziAppOptions = {}
): Promise<LaunchedBonziApp> {
  const userDataDir = await mkdtemp(
    join(tmpdir(), options.userDataDirPrefix ?? 'bonzi-e2e-')
  )

  let app: ElectronApplication | null = null
  const preparedEnv = await options.prepareUserDataDir?.(userDataDir)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir,
    ...(preparedEnv ?? {}),
    ...(options.env ?? {})
  }
  delete env.ELECTRON_RENDERER_URL

  try {
    app = await electron.launch({
      args: [join(process.cwd(), 'out/main/index.js')],
      env
    })

    const window = await app.firstWindow()

    return {
      app,
      window,
      userDataDir,
      close: async () => {
        await app?.close()
        await rm(userDataDir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await app?.close()
    await rm(userDataDir, { recursive: true, force: true })
    throw error
  }
}
