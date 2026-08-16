import { afterEach, describe, expect, test } from 'bun:test'

import { clientTelemetryConfigRoutes } from './client-config.js'

afterEach(() => {
  delete process.env.ANALYTICS_STUDIO_CLIENT_ENABLED
  delete process.env.VERCEL_ENV
})

describe('client telemetry config', () => {
  test('fails closed and is publicly cacheable for five minutes', async () => {
    const response = await clientTelemetryConfigRoutes('studio').request('/telemetry-config')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await response.json()).toEqual({ enabled: false, notice_version: 'analytics-v1' })
  })

  test('enables only from the exact surface gate', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.ANALYTICS_STUDIO_CLIENT_ENABLED = 'true'

    const response = await clientTelemetryConfigRoutes('studio').request('/telemetry-config')

    expect(await response.json()).toEqual({ enabled: true, notice_version: 'analytics-v1' })
  })

  test('stays disabled outside production even when the surface flag is true', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.ANALYTICS_STUDIO_CLIENT_ENABLED = 'true'

    const response = await clientTelemetryConfigRoutes('studio').request('/telemetry-config')

    expect(await response.json()).toEqual({ enabled: false, notice_version: 'analytics-v1' })
  })

  test('allows the configured web origin without credentials', async () => {
    const response = await clientTelemetryConfigRoutes(
      'studio',
      'https://studio.example.test',
    ).request('/telemetry-config', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example.test',
        'access-control-request-method': 'GET',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://studio.example.test')
    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    expect(response.headers.get('access-control-max-age')).toBe('600')
  })
})
