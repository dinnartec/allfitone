/**
 * PostgreSQL access for client invitations.
 *
 * All three operations run as a signed-in person. Resolution is the one that
 * differs from every other invitation in this codebase: ownership and staff
 * invitations resolve anonymously, because the invited person may have no
 * account yet. This one returns the health-data categories an organization is
 * asking for, so the database compares the invited contact against the email
 * the provider verified, and the transaction has to carry it.
 */

import { database } from '../../../platform/db/index.js'
import type {
  AccessLevel,
  ClientInvitationDatabase,
  ClientInvitationIntentStatus,
  ClientInvitationPresentation,
  ClientInvitationStatus,
  ConsentDecision,
  ScopeCode,
} from '../domain/client-invitations.js'

type IssueRow = {
  invitation_id: string
  invitation_intent_id: string
  status: ClientInvitationStatus
  channel: 'email'
  contact_hint: string
  expires_at: Date
  scope_codes: ScopeCode[]
  reused: boolean
  replayed: boolean
}

type ScopeOptionRow = {
  scope_code: ScopeCode
  offered_access_level: AccessLevel
  purpose: string
  presented_snapshot_schema_version: number
  presented_snapshot: Record<string, unknown>
  decision: ConsentDecision | null
}

type PresentationRow = {
  invitation_id: string
  status: ClientInvitationStatus
  organization_id: string
  organization_display_name: string
  responsible_party: Record<string, unknown>
  expires_at: Date
  invitation_intent_id: string
  scope_options: ScopeOptionRow[]
  invited_by: string | null
}

type PendingRow = {
  invitation_id: string
  invitation_intent_id: string
  organization_id: string
  organization_name: string
  invited_by: string | null
  expires_at: Date
}

type DecisionRow = {
  invitation_id: string
  invitation_status: ClientInvitationStatus
  organization_id: string
  invitation_intent_id: string
  intent_status: ClientInvitationIntentStatus
  relationship_id: string | null
  granted_scope_codes: ScopeCode[]
  replayed: boolean
}

export function createClientInvitationDatabase(): ClientInvitationDatabase {
  const sql = database()

  return {
    async issue(input) {
      const scopeOptions = input.scopes.map((scope) => ({
        scope_code: scope.scopeCode,
        access_level: scope.accessLevel,
        purpose: scope.purpose,
        presented_snapshot: scope.presentedSnapshot,
      }))

      const row = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${input.personId}, true),
                 set_config('app.actor_org_id', ${input.organizationId}, true),
                 set_config('app.request_id', ${input.commandId}, true)
        `
        const [issued] = await transaction<IssueRow[]>`
          select * from identity.issue_client_invitation(
            ${input.personId}::uuid,
            ${input.organizationId}::uuid,
            ${input.channel},
            ${input.contact},
            ${JSON.stringify(scopeOptions)}::text::jsonb,
            ${input.tokenHash},
            ${input.tokenKeyVersion}::smallint,
            ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid,
            ${input.requestHash}
          )
        `
        return issued
      })

      if (!row) throw new Error('issue_client_invitation returned no row')
      return {
        resource: {
          id: row.invitation_id,
          intentId: row.invitation_intent_id,
          status: row.status,
          channel: row.channel,
          contactHint: row.contact_hint,
          expiresAt: new Date(row.expires_at),
          scopeCodes: row.scope_codes ?? [],
          reused: row.reused,
        },
        replayed: row.replayed,
      }
    },

    async resolve(input) {
      const row = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${input.personId}, true),
                 set_config('app.actor_verified_email', ${input.verifiedEmail.trim().toLowerCase()}, true),
                 set_config('app.request_id', ${input.requestId}, true)
        `
        const [resolved] = await transaction<PresentationRow[]>`
          select * from identity.resolve_client_invitation(${input.tokenHash})
        `
        return resolved
      })

      return row ? presentInvitation(row) : undefined
    },

    async listMine(input) {
      const rows = await sql.begin(async (transaction) => {
        // An account still registering has no person: it is asked as the account.
        await transaction`
          select set_config('app.actor_kind', ${input.personId ? 'person' : 'account'}, true),
                 set_config('app.actor_person_id', ${input.personId ?? ''}, true),
                 set_config('app.actor_verified_email', ${input.verifiedEmail.trim().toLowerCase()}, true)
        `
        return transaction<PendingRow[]>`
          select * from identity.list_my_client_invitations()
        `
      })
      return rows.map((row) => ({
        id: row.invitation_id,
        intentId: row.invitation_intent_id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        invitedBy: row.invited_by,
        expiresAt: new Date(row.expires_at),
      }))
    },

    async readMine(input) {
      const row = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${input.personId}, true),
                 set_config('app.actor_verified_email', ${input.verifiedEmail.trim().toLowerCase()}, true)
        `
        const [read] = await transaction<PresentationRow[]>`
          select * from identity.read_my_client_invitation(${input.invitationId}::uuid)
        `
        return read
      })
      return row ? presentInvitation(row) : undefined
    },

    async decide(input) {
      const row = await sql.begin(async (transaction) => {
        await transaction`
          select set_config('app.actor_kind', 'person', true),
                 set_config('app.actor_person_id', ${input.personId}, true),
                 set_config('app.actor_verified_email', ${input.verifiedEmail.trim().toLowerCase()}, true),
                 set_config('app.request_id', ${input.commandId}, true)
        `
        const decisions = JSON.stringify(input.scopeDecisions)
        // The emailed token, or one of her pending invitations by id: same rules either way.
        const [decided] =
          'tokenHash' in input.invitation
            ? await transaction<DecisionRow[]>`
                select * from identity.decide_client_invitation(
                  ${input.personId}::uuid, ${input.invitation.tokenHash}, ${input.intentId}::uuid,
                  ${input.relationshipDecision}, ${decisions}::text::jsonb,
                  ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
                )
              `
            : await transaction<DecisionRow[]>`
                select * from identity.decide_my_client_invitation(
                  ${input.personId}::uuid, ${input.invitation.invitationId}::uuid,
                  ${input.intentId}::uuid, ${input.relationshipDecision}, ${decisions}::text::jsonb,
                  ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
                )
              `
        return decided
      })

      if (!row) throw new Error('decide_client_invitation returned no row')
      return {
        resource: {
          invitationId: row.invitation_id,
          invitationStatus: row.invitation_status,
          organizationId: row.organization_id,
          intentId: row.invitation_intent_id,
          intentStatus: row.intent_status,
          relationshipId: row.relationship_id,
          grantedScopeCodes: row.granted_scope_codes ?? [],
        },
        replayed: row.replayed,
      }
    },
  }
}

function presentInvitation(row: PresentationRow): ClientInvitationPresentation {
  return {
    id: row.invitation_id,
    intentId: row.invitation_intent_id,
    status: row.status,
    organization: {
      id: row.organization_id,
      displayName: row.organization_display_name,
      responsibleParty: row.responsible_party,
    },
    expiresAt: new Date(row.expires_at),
    invitedBy: row.invited_by,
    scopeOptions: (row.scope_options ?? []).map((option) => ({
      scopeCode: option.scope_code,
      offeredAccessLevel: option.offered_access_level,
      purpose: option.purpose,
      presentedSnapshotSchemaVersion: option.presented_snapshot_schema_version,
      presentedSnapshot: option.presented_snapshot,
      decision: option.decision,
    })),
  }
}
