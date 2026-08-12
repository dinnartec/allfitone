import {
  activeInvitationTokenKeyVersion,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenKey,
} from '@allfitone/notifications'

import type {
  CommandContext,
  IdentityInvitationDatabase,
  StudioAccountIdentity,
  StudioActor,
  TeamInvitationStatus,
  TeamInvitationRole,
  TeamInvitationPresentation,
} from '../domain/index.js'

export class StudioInvitationError extends Error {
  constructor(
    readonly code: 'registration-incomplete' | 'service-degraded' | 'forbidden' | 'not-found',
  ) {
    super(code)
    this.name = 'StudioInvitationError'
  }
}

export interface StudioInvitationService {
  issue(
    actor: StudioActor,
    input: CommandContext & {
      organizationId: string
      channel: 'email'
      contact: string
      proposedRoleCode: TeamInvitationRole
    },
  ): ReturnType<IdentityInvitationDatabase['issue']>
  resolve(token: string): Promise<TeamInvitationPresentation>
  decide(
    identity: StudioAccountIdentity,
    input: CommandContext & {
      token: string
      intentId: string
      decision: 'accepted' | 'rejected'
    },
  ): ReturnType<IdentityInvitationDatabase['decide']>
  list(
    actor: StudioActor,
    input: {
      organizationId: string
      status?: TeamInvitationStatus
      limit: number
      cursorCreatedAt?: Date
      cursorId?: string
      requestId: string
    },
  ): ReturnType<IdentityInvitationDatabase['list']>
  revoke(
    actor: StudioActor,
    input: CommandContext & { organizationId: string; invitationId: string },
  ): ReturnType<IdentityInvitationDatabase['revoke']>
}

export function createStudioInvitationService(
  database: IdentityInvitationDatabase,
  options: { enabled: boolean; environment?: NodeJS.ProcessEnv },
): StudioInvitationService {
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
    list(actor, input) {
      if (!actor.personId) throw new StudioInvitationError('registration-incomplete')
      return database.list({ personId: actor.personId, ...input })
    },
    revoke(actor, input) {
      if (!actor.personId) throw new StudioInvitationError('registration-incomplete')
      return database.revoke({ personId: actor.personId, ...input })
    },
  }
}
