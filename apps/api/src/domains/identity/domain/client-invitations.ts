/**
 * Inviting somebody to become a client, and how they answer: OP-REL-001,
 * OP-REL-015 and OP-IDN-009 for service relationships (`HU-STUDIO-023`).
 *
 * The shape that matters here is that a scope is asked for and answered one at
 * a time. An invitation carries a list of offers; a decision carries one answer
 * per offer plus one for the relationship itself. Accepting the relationship
 * grants nothing on its own, so `grantedScopeCodes` can legitimately come back
 * empty on an accepted relationship.
 *
 * Nothing in this file carries the address the invitation was sent to. What
 * comes back is a hint, and the full contact never leaves PostgreSQL.
 */

import type { CommandContext, CommandResult } from './index.js'

export type ScopeCode =
  | 'relationship_training'
  | 'prior_training_history'
  | 'body_progress'
  | 'health_context'
  | 'nutrition_intake'
  | 'nutrition_guidance'
  | 'nutrition_media'

export type AccessLevel = 'read' | 'contribute'
export type ConsentDecision = 'accepted' | 'rejected'
export type ClientInvitationStatus = 'pending' | 'completed' | 'revoked' | 'expired'
export type ClientInvitationIntentStatus = ClientInvitationStatus | 'accepted' | 'rejected'

export interface ClientInvitationScopeRequest {
  scopeCode: ScopeCode
  accessLevel: AccessLevel
  purpose: string
  presentedSnapshot: Record<string, unknown>
}

export interface ClientInvitation {
  id: string
  intentId: string
  status: ClientInvitationStatus
  channel: 'email'
  contactHint: string
  expiresAt: Date
  scopeCodes: ScopeCode[]
  reused: boolean
}

export interface ClientInvitationScopeOption {
  scopeCode: ScopeCode
  offeredAccessLevel: AccessLevel
  purpose: string
  presentedSnapshotSchemaVersion: number
  presentedSnapshot: Record<string, unknown>
  decision: ConsentDecision | null
}

export interface ClientInvitationPresentation {
  id: string
  intentId: string
  status: ClientInvitationStatus
  organization: {
    id: string
    displayName: string
    responsibleParty: Record<string, unknown>
  }
  expiresAt: Date
  /** Who sent it, by name; null when that is no longer known. */
  invitedBy: string | null
  scopeOptions: ClientInvitationScopeOption[]
}

/** An invitation still waiting, addressed to the caller's verified email. */
export interface ClientInvitationPending {
  id: string
  intentId: string
  organizationId: string
  organizationName: string
  invitedBy: string | null
  expiresAt: Date
}

export interface ClientInvitationDecisionResult {
  invitationId: string
  invitationStatus: ClientInvitationStatus
  organizationId: string
  intentId: string
  intentStatus: ClientInvitationIntentStatus
  /** Null when the relationship was rejected: nothing was created. */
  relationshipId: string | null
  grantedScopeCodes: ScopeCode[]
}

export interface ClientInvitationDatabase {
  issue(
    input: CommandContext & {
      personId: string
      organizationId: string
      channel: 'email'
      contact: string
      scopes: ClientInvitationScopeRequest[]
      tokenHash: Uint8Array
      tokenKeyVersion: number
    },
  ): Promise<CommandResult<ClientInvitation>>

  resolve(input: {
    personId: string
    verifiedEmail: string
    tokenHash: Uint8Array
    requestId: string
  }): Promise<ClientInvitationPresentation | undefined>

  /** Somebody still registering has no person yet, and may still be told. */
  listMine(input: {
    personId: string | null
    verifiedEmail: string
  }): Promise<ClientInvitationPending[]>

  readMine(input: {
    personId: string
    verifiedEmail: string
    invitationId: string
  }): Promise<ClientInvitationPresentation | undefined>

  decide(
    input: CommandContext & {
      personId: string
      verifiedEmail: string
      /** The emailed token's hash, or the id of one of her pending invitations. */
      invitation: { tokenHash: Uint8Array } | { invitationId: string }
      intentId: string
      relationshipDecision: ConsentDecision
      scopeDecisions: Record<string, ConsentDecision>
    },
  ): Promise<CommandResult<ClientInvitationDecisionResult>>
}
