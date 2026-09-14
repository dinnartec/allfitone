/**
 * PostgreSQL access for ownership invitations.
 *
 * Resolution runs as the anonymous actor, because the owner may not have an account
 * yet. The decision runs as the person with the email their provider verified, which
 * the database compares with the invited one.
 */

import { database } from '../../../platform/db/index.js'
import type { OwnershipInvitationDatabase } from '../domain/ownership-invitations.js'

type PresentationRow = {
  invitation_id: string
  organization_id: string
  organization_display_name: string
  organization_type_name: string
  party_kind: 'natural_person' | 'legal_entity'
  legal_name: string | null
  site_name: string | null
  expires_at: Date
  invitation_intent_id: string
}

type DecisionRow = {
  invitation_id: string
  invitation_status: 'completed'
  organization_id: string
  invitation_intent_id: string
  intent_status: 'accepted' | 'rejected'
  membership_id: string | null
  replayed: boolean
}

export function createOwnershipInvitationDatabase(): OwnershipInvitationDatabase {
  const sql = database()

  return {
    async resolve(tokenHash) {
      const result = await sql.begin(async (transaction) => {
        await transaction`select set_config('app.actor_kind', 'anonymous', true)`
        const [row] = await transaction<PresentationRow[]>`
          select * from identity.resolve_ownership_invitation(${tokenHash})
        `
        return { row }
      })
      const row = result.row
      if (!row) return undefined
      return {
        id: row.invitation_id,
        organization: {
          id: row.organization_id,
          displayName: row.organization_display_name,
          typeName: row.organization_type_name,
          partyKind: row.party_kind,
          legalName: row.legal_name,
          siteName: row.site_name,
        },
        expiresAt: new Date(row.expires_at),
        intent: { id: row.invitation_intent_id, status: 'pending' },
      }
    },

    async decide(input) {
      const result = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${input.personId}, true),
                 set_config('app.actor_verified_email', ${input.verifiedEmail.trim().toLowerCase()}, true),
                 set_config('app.request_id', ${input.commandId}, true)
        `
        const [row] = await transaction<DecisionRow[]>`
          select * from identity.decide_ownership_invitation(
            ${input.personId}::uuid,
            ${input.tokenHash},
            ${input.intentId}::uuid,
            ${input.decision},
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        return { row }
      })
      const row = result.row
      if (!row) throw new Error('PostgreSQL did not decide the ownership invitation')
      return {
        resource: {
          invitationId: row.invitation_id,
          invitationStatus: row.invitation_status,
          organizationId: row.organization_id,
          intentId: row.invitation_intent_id,
          intentStatus: row.intent_status,
          membershipId: row.membership_id,
        },
        replayed: row.replayed,
      }
    },
  }
}
