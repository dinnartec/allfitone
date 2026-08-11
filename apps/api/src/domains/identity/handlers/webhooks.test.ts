import { describe, expect, test } from 'bun:test'
import { AuthError } from '@allfitone/auth-provider'
import { Hono } from 'hono'

import type { IdentityWebhookService } from '../application/webhooks.js'
import { workosWebhookRoutes } from './webhooks.js'

function app(service: IdentityWebhookService): Hono {
  const instance = new Hono()
  instance.route('/webhooks', workosWebhookRoutes(service))
  return instance
}

describe('POST /webhooks/workos', () => {
  test('passes the raw body and signature intact and returns an empty no-store response', async () => {
    let input: [string, string] | undefined
    const response = await app({
      process: async (rawPayload, signature) => {
        input = [rawPayload, signature]
        return 'processed'
      },
    }).request('/webhooks/workos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'WorkOS-Signature': 't=123,v1=signed',
      },
      body: '{\n  "order": [2, 1], "spacing": true\n}',
    })

    expect(input).toEqual(['{\n  "order": [2, 1], "spacing": true\n}', 't=123,v1=signed'])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('returns 200 for replay, absent account and ignored signed events', async () => {
    for (const outcome of ['replayed', 'account-absent', 'ignored'] as const) {
      const response = await app({ process: async () => outcome }).request('/webhooks/workos', {
        method: 'POST',
        headers: { 'WorkOS-Signature': 'signed' },
        body: '{}',
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('returns 400 and never enters the use case without a signature', async () => {
    let calls = 0
    const response = await app({
      process: async () => {
        calls += 1
        return 'processed'
      },
    }).request('/webhooks/workos', { method: 'POST', body: '{}' })

    expect(response.status).toBe(400)
    expect(calls).toBe(0)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('returns 400 for an invalid signature or unreadable provider payload', async () => {
    const response = await app({
      process: async () => {
        throw new AuthError('invalid_webhook')
      },
    }).request('/webhooks/workos', {
      method: 'POST',
      headers: { 'WorkOS-Signature': 'bad' },
      body: 'not-json',
    })

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('returns 413 before the use case for a body larger than 64 KiB', async () => {
    let calls = 0
    const response = await app({
      process: async () => {
        calls += 1
        return 'processed'
      },
    }).request('/webhooks/workos', {
      method: 'POST',
      headers: { 'WorkOS-Signature': 'signed' },
      body: 'x'.repeat(64 * 1024 + 1),
    })

    expect(response.status).toBe(413)
    expect(calls).toBe(0)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('returns 503 so WorkOS retries when PostgreSQL cannot confirm', async () => {
    const response = await app({
      process: async () => {
        throw new Error('database unavailable')
      },
    }).request('/webhooks/workos', {
      method: 'POST',
      headers: { 'WorkOS-Signature': 'signed' },
      body: '{}',
    })

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
