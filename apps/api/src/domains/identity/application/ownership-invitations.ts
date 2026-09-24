/**
 * Ownership invitation use cases for Studio.
 *
 * The token is hashed here and never travels further. A person who has not finished
 * registering, or whose provider has not verified the email, is refused before the
 * database is asked, because the decision compares that verified email with the one
 * Allfit invited.
 */

import { hashInvitationToken } from '@allfitone/notifications'

import type { CommandContext, StudioAccountIdentity } from '../domain/index.js'
import type {
  OwnershipInvitationDatabase,
  OwnershipInvitationPresentation,
} from '../domain/ownership-invitations.js'
import { StudioInvitationError } from './invitations.js'

export interface StudioOwnershipInvitationService {
  resolve(token: string): Promise<OwnershipInvitationPresentation>
  decide(
    identity: StudioAccountIdentity,
    input: CommandContext & {
      token: string
      intentId: string
      decision: 'accepted' | 'rejected'
    },
  ): ReturnType<OwnershipInvitationDatabase['decide']>
}

export function createStudioOwnershipInvitationService(
  database: OwnershipInvitationDatabase,
): StudioOwnershipInvitationService {
  return {
    async resolve(token) {
      const invitation = await database.resolve(hashInvitationToken(token))
      if (!invitation) throw new StudioInvitationError('not-found')
      return invitation
    },
    decide(identity, input) {
      if (!identity.actor.personId) throw new StudioInvitationError('registration-incomplete')
      if (!identity.identity.verifiedEmail) throw new StudioInvitationError('forbidden')
      return database.decide({
        personId: identity.actor.personId,
        verifiedEmail: identity.identity.verifiedEmail,
        tokenHash: hashInvitationToken(input.token),
        intentId: input.intentId,
        decision: input.decision,
        idempotencyKey: input.idempotencyKey,
        commandId: input.commandId,
        requestHash: input.requestHash,
      })
    },
  }
}
