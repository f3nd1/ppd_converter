import { defineConfig } from '@playwright/test'

// Runs against a real built server on a separate port and a throwaway database,
// so an E2E run can never touch the development database. Google and OpenAI are
// simply not configured — these tests cover everything that does not need them,
// and prove the server blocks what it should.
const PORT = 4021

export default defineConfig({
  testDir: './e2e',
  // Serial: the specs build on each other's state (add a sub-criterion, then
  // approve a mapping), which mirrors how the app is actually used.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Some environments provide a preinstalled Chromium at a fixed path rather
    // than the version-matched download Playwright expects. Set
    // PLAYWRIGHT_CHROMIUM_PATH to use it; unset, Playwright behaves normally.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'e2e',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: 'e2e/.auth.json' },
    },
  ],
  webServer: {
    command: `rm -f data/e2e.db* && npx prisma migrate deploy && node --experimental-strip-types prisma/seed.ts && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/ppd_converter/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'file:./data/e2e.db',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      SESSION_SECRET: 'e2e-session-secret-at-least-32-characters-long',
    },
  },
})
