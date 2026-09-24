/**
 * PostgreSQL access for credential verification.
 *
 * Verification runs as the support actor. The two reads write an access record
 * against every holder they return, inside the same transaction, so a read whose
 * record fails returns nothing.
 *
 * Dates are cast to text in the select: a `date` column arrives from the driver as
 * a JavaScript `Date` at midnight UTC, which would serialise as a timestamp and
 * break the contract's `format: date`.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  CredentialRenewalDue,
  CredentialVerificationDatabase,
  CredentialVerificationOutcome,
  CredentialVerificationRequest,
} from '../domain/index.js'

type CommandRow = { result: CredentialVerificationOutcome; replayed: boolean }

export function createCredentialVerificationDatabase(): CredentialVerificationDatabase {
  const sql = database()

  return {
    listRequests: (input) =>
      inTransaction(
        sql,
        input.actorPersonId,
        input.requestId,
        (transaction) =>
          transaction<CredentialVerificationRequest[]>`
          select
            request_id, kind, requested_at, credential_id, credential_type_code,
            credential_type_name, issuer, credential_name, credential_identifier,
            issued_on::text as issued_on, expires_on::text as expires_on, verification_url,
            holder_person_id, holder_given_name, holder_family_name, suggested_method,
            previous_result, previous_valid_to, viewer_can_decide
          from identity.list_credential_verification_requests(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.limit ?? null}::integer
          )
        `,
      ),

    decide: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const decision = input.decision
        const [row] = await transaction<CommandRow[]>`
          select * from identity.decide_credential_verification(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${decision.request_id}::uuid, ${decision.result}, ${decision.method},
            ${decision.source_authority}, ${decision.source_jurisdiction},
            ${decision.source_reference}, ${decision.source_status},
            ${decision.source_checked_at}::timestamptz,
            ${decision.source_valid_to ?? null}::timestamptz,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the verification decision')
        return { resource: row.result, replayed: row.replayed }
      }),

    listDueRenewals: (input) =>
      inTransaction(
        sql,
        input.actorPersonId,
        input.requestId,
        (transaction) =>
          transaction<CredentialRenewalDue[]>`
          select
            credential_id, credential_type_code, credential_type_name, credential_name,
            issuer, holder_person_id, holder_given_name, holder_family_name, last_valid_to
          from identity.list_due_credential_renewals(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.limit ?? null}::integer
          )
        `,
      ),

    openRenewal: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<CommandRow[]>`
          select * from identity.open_credential_verification_renewal(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.credentialId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not open the verification renewal')
        return { resource: row.result, replayed: row.replayed }
      }),
  }
}

function inTransaction<T>(
  sql: ReturnType<typeof database>,
  actorPersonId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'support', true),
               set_config('app.actor_person_id', ${actorPersonId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
