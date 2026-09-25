import { describe, expect, test } from 'bun:test'
import { AuthError, type AuthProvider } from '@allfitone/auth-provider'

import type { IdentityWebhookDatabase } from '../domain/index.js'
import { createIdentityWebhookService } from './webhooks.js'

function provider(verifyWebhookEvent: AuthProvider['verifyWebhookEvent']): AuthProvider {
  return {
    getAuthorizationUrl: () => '',
    getLogoutUrl: () => '',
    register: async () => ({ created: false }),
    verifyEmail: async () => {
      throw new Error('not used')
    },
    authenticateWithPassword: async () => {
      throw new Error('not used')
    },
    authenticateWithCode: async () => {
      throw new Error('not used')
    },
    refresh: async () => {
      throw new Error('not used')
    },
    verifyAccessToken: async () => {
      throw new Error('not used')
    },
    verifyWebhookEvent,
    updateEmail: async () => undefined,
    identityFor: async () => ({ givenName: null, familyName: null, verifiedEmail: null }),
    enrollTotp: async () => {
      throw new Error('not used')
    },
    challengeTotp: async () => {
      throw new Error('not used')
    },
    verifyTotp: async () => {
      throw new Error('not used')
    },
    deleteAuthenticationFactor: async () => undefined,
    requestPasswordReset: async () => undefined,
    revokeSession: async () => undefined,
    revokeSessions: async () => undefined,
  }
}

function database(
  processPasswordResetSucceeded: IdentityWebhookDatabase['processPasswordResetSucceeded'],
): IdentityWebhookDatabase {
  return { processPasswordResetSucceeded }
}

describe('Identity webhook use case', () => {
  test('persists only after verification and preserves the normalized event', async () => {
    const order: string[] = []
    let received:
      Parameters<IdentityWebhookDatabase['processPasswordResetSucceeded']>[0] | undefined
    const service = createIdentityWebhookService({
      issuer: 'https://issuer.test',
      authProvider: provider(async (rawPayload, signature) => {
        order.push(`verify:${rawPayload}:${signature}`)
        return {
          kind: 'password-reset-succeeded',
          eventId: 'event_1',
          subject: 'user_1',
          occurredAt: '2026-08-10T12:00:00.000Z',
        }
      }),
      database: database(async (input) => {
        order.push('database')
        received = input
        return { outcome: 'processed', revokedSessionCount: 2, replayed: false }
      }),
    })

    await expect(service.process('raw payload', 'signed')).resolves.toBe('processed')
    expect(order).toEqual(['verify:raw payload:signed', 'database'])
    expect(received).toEqual({
      provider: 'workos',
      issuer: 'https://issuer.test',
      eventId: 'event_1',
      subject: 'user_1',
      occurredAt: '2026-08-10T12:00:00.000Z',
    })
  })

  test('does not call PostgreSQL when signature verification fails', async () => {
    let databaseCalls = 0
    const service = createIdentityWebhookService({
      issuer: 'https://issuer.test',
      authProvider: provider(async () => {
        throw new AuthError('invalid_webhook')
      }),
      database: database(async () => {
        databaseCalls += 1
        return { outcome: 'processed', revokedSessionCount: 0, replayed: false }
      }),
    })

    await expect(service.process('raw', 'bad')).rejects.toMatchObject({
      code: 'invalid_webhook',
    })
    expect(databaseCalls).toBe(0)
  })

  test('ignores a verified event outside the closed projection without using PostgreSQL', async () => {
    let databaseCalls = 0
    const service = createIdentityWebhookService({
      issuer: 'https://issuer.test',
      authProvider: provider(async () => null),
      database: database(async () => {
        databaseCalls += 1
        return { outcome: 'processed', revokedSessionCount: 0, replayed: false }
      }),
    })

    await expect(service.process('raw', 'signed')).resolves.toBe('ignored')
    expect(databaseCalls).toBe(0)
  })

  test('maps durable replays independently from the original result', async () => {
    const service = createIdentityWebhookService({
      issuer: 'https://issuer.test',
      authProvider: provider(async () => ({
        kind: 'password-reset-succeeded',
        eventId: 'event_1',
        subject: 'user_1',
        occurredAt: '2026-08-10T12:00:00.000Z',
      })),
      database: database(async () => ({
        outcome: 'account-absent',
        revokedSessionCount: 0,
        replayed: true,
      })),
    })

    await expect(service.process('raw', 'signed')).resolves.toBe('replayed')
  })
})
