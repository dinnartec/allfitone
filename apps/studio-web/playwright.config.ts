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
  /**
   * A production build, not the development server. The two stopped agreeing:
   * development runs an effect twice on purpose, so the session guard verified
   * once here and twice in production, and the sweep called that green while
   * every visitor paid a second audited read. Anything that differs between the
   * two is invisible to a suite that only ever sees one of them, and the suite
   * exists to describe what ships.
   *
   * `reuseExistingServer` still stands: a development server already listening
   * on this port is used as-is, which keeps hot reload available while writing
   * a test.
   */
  webServer: {
    command: 'bun run start:e2e',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
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
