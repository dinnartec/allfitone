/**
 * Startup validation.
 *
 * A missing credential must stop a deploy, not surface as a confusing 500 an
 * hour later. Each variable is checked by name so the error says what to set.
 */

import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { createAuthProviderFromEnv } from './factory.js'

const COMPLETE = {
  WORKOS_CLIENT_ID_SPACE: 'client_space',
  WORKOS_CLIENT_ID_STUDIO: 'client_studio',
  WORKOS_CLIENT_ID_BACKOFFICE: 'client_backoffice',
  // One key per Application, not one shared key.
  WORKOS_API_KEY_SPACE: 'sk_space',
  WORKOS_API_KEY_STUDIO: 'sk_studio',
  WORKOS_API_KEY_BACKOFFICE: 'sk_backoffice',
  // One per environment, not per Application — the provider builds it from the
  // environment's default Application.
  WORKOS_ISSUER: 'https://api.workos.com/user_management/client_01DEFAULTAPP',
  WORKOS_WEBHOOK_SECRET: 'whsec_test',
}

describe('createAuthProviderFromEnv', () => {
  test('constructs when every variable is present', () => {
    expect(() => createAuthProviderFromEnv(COMPLETE)).not.toThrow()
  })

  test('names the missing variable rather than failing vaguely', () => {
    for (const name of Object.keys(COMPLETE)) {
      const incomplete = { ...COMPLETE, [name]: undefined }
      expect(() => createAuthProviderFromEnv(incomplete)).toThrow(name)
    }
  })

  test('treats an empty string as missing', () => {
    // A .env.local copied from the template has empty values, which is the most
    // likely way this fails in practice.
    expect(() => createAuthProviderFromEnv({ ...COMPLETE, WORKOS_API_KEY_STUDIO: '' })).toThrow(
      'WORKOS_API_KEY_STUDIO',
    )
  })

  test('points at the example file so the fix is obvious', () => {
    expect(() => createAuthProviderFromEnv({})).toThrow(/\.env\.example/)
  })
})

function signed(payload: string, timestamp: number): string {
  const hash = createHmac('sha256', COMPLETE.WORKOS_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return `t=${timestamp},v1=${hash}`
}

const RESET_PAYLOAD = JSON.stringify({
  id: 'event_01RESET',
  created_at: '2026-08-10T12:00:00.000Z',
  event: 'password_reset.succeeded',
  context: { source: 'must-not-escape' },
  data: {
    object: 'password_reset',
    id: 'password_reset_private',
    user_id: 'user_01RESET',
    email: 'private@example.com',
    expires_at: '2026-08-10T13:00:00.000Z',
    created_at: '2026-08-10T11:55:00.000Z',
  },
})

describe('real WorkOS webhook verification', () => {
  test('accepts a correctly signed event and returns the PII-free projection', async () => {
    const provider = createAuthProviderFromEnv(COMPLETE)
    const timestamp = Date.now()

    await expect(
      provider.verifyWebhookEvent(RESET_PAYLOAD, signed(RESET_PAYLOAD, timestamp)),
    ).resolves.toEqual({
      kind: 'password-reset-succeeded',
      eventId: 'event_01RESET',
      subject: 'user_01RESET',
      occurredAt: '2026-08-10T12:00:00.000Z',
    })
  })

  test('accepts delivery inside 300 seconds and rejects delivery outside it', async () => {
    const provider = createAuthProviderFromEnv(COMPLETE)
    const inside = Date.now() - 299_000
    const outside = Date.now() - 301_000

    await expect(
      provider.verifyWebhookEvent(RESET_PAYLOAD, signed(RESET_PAYLOAD, inside)),
    ).resolves.toMatchObject({ eventId: 'event_01RESET' })
    await expect(
      provider.verifyWebhookEvent(RESET_PAYLOAD, signed(RESET_PAYLOAD, outside)),
    ).rejects.toMatchObject({ code: 'invalid_webhook' })
  })
})
