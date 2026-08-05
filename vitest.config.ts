import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{server,src,scripts}/**/__tests__/**/*.test.{ts,tsx}'],
  },
})
