import { describe, expect, test } from 'bun:test'

import { createApp } from './application.js'

describe('public telemetry gates', () => {
  test('are anonymous, fail closed and cache for five minutes', async () => {
    const previous = {
      studio: process.env.ANALYTICS_STUDIO_CLIENT_ENABLED,
      space: process.env.ANALYTICS_SPACE_CLIENT_ENABLED,
      backoffice: process.env.ANALYTICS_BACKOFFICE_CLIENT_ENABLED,
      vercelEnv: process.env.VERCEL_ENV,
    }
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
    delete process.env.ANALYTICS_STUDIO_CLIENT_ENABLED
    process.env.ANALYTICS_SPACE_CLIENT_ENABLED = 'true'
    process.env.ANALYTICS_BACKOFFICE_CLIENT_ENABLED = 'false'
    process.env.VERCEL_ENV = 'production'

    try {
      const app = createApp()
      const studio = await app.request('/studio/v1/telemetry-config')
      const space = await app.request('/space/v1/telemetry-config')
      const backoffice = await app.request('/backoffice/v1/telemetry-config')

      expect(await studio.json()).toEqual({ enabled: false, notice_version: 'analytics-v1' })
      expect(await space.json()).toEqual({ enabled: true, notice_version: 'analytics-v1' })
      expect(await backoffice.json()).toEqual({ enabled: false, notice_version: 'analytics-v1' })
      for (const response of [studio, space, backoffice]) {
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('public, max-age=300')
        expect(response.headers.get('server-timing')).toContain('total;dur=')
        expect(response.headers.get('set-cookie')).toBeNull()
      }
    } finally {
      restore('ANALYTICS_STUDIO_CLIENT_ENABLED', previous.studio)
      restore('ANALYTICS_SPACE_CLIENT_ENABLED', previous.space)
      restore('ANALYTICS_BACKOFFICE_CLIENT_ENABLED', previous.backoffice)
      restore('VERCEL_ENV', previous.vercelEnv)
    }
  })

  test('exposes timing headers and caches web preflight policy', async () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'

    const response = await createApp().request('/backoffice/v1/telemetry-config', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://backoffice.example.test',
        'access-control-request-method': 'GET',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://backoffice.example.test',
    )
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain(
      'server-timing',
    )
  })
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
