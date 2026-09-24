/**
 * An organization Allfit handed over, as its future owner meets it: OP-IDN-016 and
 * OP-IDN-009 for ownership (`HU-BO-014`).
 *
 * The owner resolves the token anonymously and decides signed in. Everything that
 * decides — the invited email, whether the organization still waits for its owner,
 * whether the person deciding is the one who handed it over — is checked in
 * PostgreSQL. Nothing here carries the address the invitation went to.
 */

import type { CommandContext, CommandResult } from './index.js'

export interface OwnershipInvitationPresentation {
  id: string
  organization: {
    id: string
    displayName: string
    typeName: string
    partyKind: 'natural_person' | 'legal_entity'
    legalName: string | null
    siteName: string | null
  }
  expiresAt: Date
  intent: { id: string; status: 'pending' }
}

export interface OwnershipInvitationDecisionResult {
  invitationId: string
  invitationStatus: 'completed'
  organizationId: string
  intentId: string
  intentStatus: 'accepted' | 'rejected'
  membershipId: string | null
}

export interface OwnershipInvitationDatabase {
  resolve(tokenHash: Uint8Array): Promise<OwnershipInvitationPresentation | undefined>
  decide(
    input: CommandContext & {
      personId: string
      verifiedEmail: string
      tokenHash: Uint8Array
      intentId: string
      decision: 'accepted' | 'rejected'
    },
  ): Promise<CommandResult<OwnershipInvitationDecisionResult>>
}
