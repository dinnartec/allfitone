import { defineConfig, devices } from '@playwright/test'

const PORT = 3201
const BASE_URL = `http://127.0.0.1:${String(PORT)}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The production build: what ships is what the suite describes.
  webServer: {
    command: 'bun run start:e2e',
    url: `${BASE_URL}/es`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { ...process.env, NEXT_DIST_DIR: '.next-e2e' },
  },
})
