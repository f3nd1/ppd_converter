import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Two projects rather than one jsdom run: server code is Node-only, and running
// it under jsdom would both slow it down and hide Node-specific mistakes.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['{server,scripts}/**/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
})
