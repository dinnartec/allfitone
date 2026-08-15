import { defineConfig, devices } from '@playwright/test'

const PORT = 3101
const BASE_URL = `http://127.0.0.1:${PORT}`

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
  webServer: {
    command: 'bun run dev:e2e',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8080',
      NEXT_PUBLIC_STAFF_INVITATIONS_ENABLED: 'true',
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_non_production_e2e',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
      NEXT_PUBLIC_ANALYTICS_ENVIRONMENT: 'development',
      NEXT_PUBLIC_APP_RELEASE: 'e2e',
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
})
