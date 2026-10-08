import { describe, expect, test } from 'bun:test'

import { createApp } from './application.js'

describe('Studio surface CORS', () => {
  test('allows command headers on onboarding preflight through the assembled application', async () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'

    const response = await createApp().request('/studio/v1/onboarding-attempts', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'command-id,content-type,idempotency-key',
      },
    })

    const allowedHeaders = (response.headers.get('access-control-allow-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((header) => header.trim())

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://studio.example.test')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase()).toContain(
      'server-timing',
    )
    expect(allowedHeaders).toEqual(
      expect.arrayContaining(['content-type', 'idempotency-key', 'command-id']),
    )
  })

  test('allows profile PUT and catalogue revalidation headers through the assembled application', async () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'

    const profile = await createApp().request('/studio/v1/me/professional-profile', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example.test',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'command-id,content-type,idempotency-key',
      },
    })
    const catalogue = await createApp().request('/studio/v1/professional-specialties', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://studio.example.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'if-none-match',
      },
    })

    expect(profile.status).toBe(204)
    expect(profile.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(catalogue.status).toBe(204)
    expect(catalogue.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'if-none-match',
    )
  })

  /*
   * Retiring a site is a PATCH, and it was blocked in production: eleven
   * sub-applications mount at `/studio/v1`, each registered its own `cors()`,
   * and the first one to run answered every preflight on the surface. It served
   * no PATCH, so it said so, and the browser refused to send the request — while
   * the handler that does serve PATCH had it configured all along, uselessly.
   *
   * This asserts the surface's answer rather than any one handler's, which is
   * the only thing a browser ever sees.
   */
  test('allows PATCH and If-Match on a site preflight, which no single handler decides', async () => {
    process.env.API_PUBLIC_URL = 'https://api.example.test'
    process.env.STUDIO_WEB_URL = 'https://studio.example.test'
    process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'

    const site = await createApp().request(
      '/studio/v1/organizations/019a0ab9-b723-7b7b-954d-5385eb5d1ea9/sites/019a1195-9cd8-7b28-8d54-794366a94883',
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://studio.example.test',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'content-type,if-match,command-id',
        },
      },
    )

    const allowedMethods = (site.headers.get('access-control-allow-methods') ?? '')
      .toUpperCase()
      .split(',')
      .map((method) => method.trim())
    const allowedHeaders = (site.headers.get('access-control-allow-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((header) => header.trim())

    expect(site.status).toBe(204)
    expect(allowedMethods).toContain('PATCH')
    expect(allowedHeaders).toEqual(
      expect.arrayContaining(['content-type', 'if-match', 'command-id']),
    )
  })
})
