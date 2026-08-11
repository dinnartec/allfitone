import {
  activeInvitationTokenKeyVersion,
  createInvitationToken,
  hashInvitationToken,
  invitationTokenKey,
} from '@allfitone/notifications'

import type {
  CommandContext,
  IdentityInvitationDatabase,
  StudioActor,
  TeamInvitationRole,
} from '../domain/index.js'

export class StudioInvitationError extends Error {
  constructor(readonly code: 'registration-incomplete' | 'service-degraded') {
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
  }
}
