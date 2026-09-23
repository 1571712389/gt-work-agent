import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const agentCore = resolve(__dirname, '../../packages/agent-core/src/index.ts')
const mcpHost = resolve(__dirname, '../../packages/mcp-host/src/index.ts')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@gt-workbench/agent-core': agentCore,
        '@gt-workbench/mcp-host': mcpHost,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
