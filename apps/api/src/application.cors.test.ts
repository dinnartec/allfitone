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
})
