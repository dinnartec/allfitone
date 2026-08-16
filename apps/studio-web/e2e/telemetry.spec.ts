import { expect, test } from '@playwright/test'

import { createStudioApiFixture, installStudioApiMock, TEST_ANALYTICS_ID } from './studio-api-mock'

test.use({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
})

test('does not load or contact PostHog before explicit consent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => ({
        brands: [{ brand: 'Chromium', version: '151' }],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: async () => ({}),
      }),
    })
  })
  const fixture = createStudioApiFixture()
  const deliveries: string[] = []
  const providerRequests: string[] = []

  await page.route('https://us.i.posthog.com/**', async (route) => {
    providerRequests.push(route.request().url())
    deliveries.push(route.request().postData() ?? '')
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('https://us-assets.i.posthog.com/**', async (route) => {
    providerRequests.push(route.request().url())
    if (route.request().url().endsWith('/config.js')) {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        supportedCompression: [],
        autocapture_opt_out: true,
        sessionRecording: false,
        surveys: false,
        heatmaps: false,
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        hasFeatureFlags: false,
      }),
    })
  })
  await installStudioApiMock(page, fixture, { consent: 'undecided' })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Permitir analítica' })).toBeVisible()
  await page.waitForTimeout(300)

  expect(deliveries).toHaveLength(0)
  expect(providerRequests).toHaveLength(0)
  expect(fixture.requests.some((request) => request.path.endsWith('/telemetry-config'))).toBe(false)

  await page.getByRole('button', { name: 'Permitir analítica' }).click()

  await expect
    .poll(
      () => fixture.requests.filter((request) => request.path.endsWith('/telemetry-config')).length,
    )
    .toBe(1)
  await expect.poll(() => deliveries.length).toBeGreaterThan(0)

  const delivered = deliveries.join('\n')
  expect(delivered).toContain(TEST_ANALYTICS_ID)
  expect(delivered).not.toContain('Ada')
  expect(delivered).not.toContain('Lovelace')
  expect(delivered).not.toContain('127.0.0.1')
  expect(delivered).not.toContain('$current_url')
  expect(delivered).not.toContain('$device_id')
  expect(delivered).not.toContain('$lib')
  expect(delivered).not.toContain('$pageview')
  expect(delivered).not.toContain('$identify')

  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('allfit.analytics-v1') ?? 'null')),
    )
    .toEqual({ decision: 'granted', notice_version: 'analytics-v1' })
})
