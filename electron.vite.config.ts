import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const bundledElizaPackages = [
  '@elizaos/core',
  '@elizaos/plugin-eliza-classic',
  '@elizaos/plugin-localdb',
  '@elizaos/plugin-openai'
]

const optionalRuntimeExternals = ['sharp']

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: bundledElizaPackages
      })
    ],
    build: {
      rollupOptions: {
        external: optionalRuntimeExternals
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: bundledElizaPackages
      })
    ],
    build: {
      rollupOptions: {
        external: optionalRuntimeExternals
      }
    }
  },
  renderer: {
    publicDir: resolve(__dirname, 'public'),
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true
    }
  }
})
