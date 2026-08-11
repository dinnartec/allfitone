/** Identity-provider webhook use cases. No HTTP and no direct SQL. */

import type { AuthProvider } from '@allfitone/auth-provider'

import type { IdentityWebhookDatabase } from '../domain/index.js'

export type IdentityWebhookOutcome = 'account-absent' | 'ignored' | 'processed' | 'replayed'

export interface IdentityWebhookService {
  process(rawPayload: string, signature: string): Promise<IdentityWebhookOutcome>
}

export function createIdentityWebhookService(dependencies: {
  authProvider: AuthProvider
  database: IdentityWebhookDatabase
  issuer: string
}): IdentityWebhookService {
  return {
    async process(rawPayload, signature) {
      const event = await dependencies.authProvider.verifyWebhookEvent(rawPayload, signature)
      if (!event) return 'ignored'

      const result = await dependencies.database.processPasswordResetSucceeded({
        provider: 'workos',
        issuer: dependencies.issuer,
        eventId: event.eventId,
        subject: event.subject,
        occurredAt: event.occurredAt,
      })
      if (result.replayed) return 'replayed'
      return result.outcome
    },
  }
}
