/**
 * Client invitation use cases, spanning both surfaces: Studio issues, Space
 * reads and answers.
 *
 * The token is derived from the command id, as it is for team invitations, so
 * replaying a command derives the same token instead of issuing a second one.
 * It is hashed here and the hash is all PostgreSQL ever sees.
 *
 * Space callers are identified by the email their provider verified, which the
 * database compares with the invited contact. Somebody who has not finished
 * registering, or whose email is unverified, is refused before the database is
 * asked — there is nothing to compare against.
 */

import {
  activeInvitationTokenKeyVersion,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenKey,
} from '@allfitone/notifications'

import type { AccountActor, CommandContext } from '../domain/index.js'
import type {
  ClientInvitationDatabase,
  ClientInvitationPresentation,
  ClientInvitationScopeRequest,
  ConsentDecision,
} from '../domain/client-invitations.js'
import { StudioInvitationError } from './invitations.js'

/** What a Space caller proved about themselves before any of this runs. */
export interface SpaceInvitationIdentity {
  personId: string | null
  verifiedEmail: string | null
}

export interface ClientInvitationService {
  issue(
    actor: AccountActor,
    input: CommandContext & {
      organizationId: string
      channel: 'email'
      contact: string
      scopes: ClientInvitationScopeRequest[]
    },
  ): ReturnType<ClientInvitationDatabase['issue']>

  resolve(
    identity: SpaceInvitationIdentity,
    input: { token: string; requestId: string },
  ): Promise<ClientInvitationPresentation>

  decide(
    identity: SpaceInvitationIdentity,
    input: CommandContext & {
      token: string
      intentId: string
      relationshipDecision: ConsentDecision
      scopeDecisions: Record<string, ConsentDecision>
    },
  ): ReturnType<ClientInvitationDatabase['decide']>
}

export function createClientInvitationService(
  database: ClientInvitationDatabase,
  options: { enabled: boolean; environment?: NodeJS.ProcessEnv },
): ClientInvitationService {
  return {
    issue(actor, input) {
      if (!options.enabled) throw new StudioInvitationError('service-degraded')
      if (!actor.personId) throw new StudioInvitationError('registration-incomplete')
      const environment = options.environment ?? process.env
      const tokenKeyVersion = activeInvitationTokenKeyVersion(environment)
      const token = createInvitationToken(
        input.commandId,
        invitationTokenKey(tokenKeyVersion, environment),
      )
      return database.issue({
        personId: actor.personId,
        ...input,
        tokenHash: hashInvitationToken(token),
        tokenKeyVersion,
      })
    },

    async resolve(identity, input) {
      const caller = requireVerifiedCaller(identity)
      const invitation = await database.resolve({
        personId: caller.personId,
        verifiedEmail: caller.verifiedEmail,
        tokenHash: hashInvitationToken(input.token),
        requestId: input.requestId,
      })
      if (!invitation) throw new StudioInvitationError('not-found')
      return invitation
    },

    decide(identity, input) {
      const caller = requireVerifiedCaller(identity)
      return database.decide({
        personId: caller.personId,
        verifiedEmail: caller.verifiedEmail,
        tokenHash: hashInvitationToken(input.token),
        intentId: input.intentId,
        relationshipDecision: input.relationshipDecision,
        scopeDecisions: input.scopeDecisions,
        idempotencyKey: input.idempotencyKey,
        commandId: input.commandId,
        requestHash: input.requestHash,
      })
    },
  }
}

function requireVerifiedCaller(identity: SpaceInvitationIdentity): {
  personId: string
  verifiedEmail: string
} {
  if (!identity.personId) throw new StudioInvitationError('registration-incomplete')
  if (!identity.verifiedEmail) throw new StudioInvitationError('forbidden')
  return { personId: identity.personId, verifiedEmail: identity.verifiedEmail }
}
