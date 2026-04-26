/// <reference types="vite/client" />

import type { BonziBridge } from '../shared/ipc-contracts'

declare global {
  interface Window {
    bonzi: BonziBridge
  }
}

export {}
