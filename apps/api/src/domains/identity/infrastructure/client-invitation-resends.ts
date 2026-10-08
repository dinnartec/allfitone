/**
 * PostgreSQL access for client invitation resends.
 *
 * Both operations run as the support actor with the request identifier in transaction
 * scope. The actor identifier is not decoration here: the policy that lets support
 * read what an invitation offered is resolved from it, and a reissue that could not
 * read the offer is refused rather than sent asking for nothing.
 *
 * The list writes no access record: an invitation names no person until someone
 * accepts it, and its contact only travels as a hint.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  BackofficeClientInvitationList,
  BackofficeClientInvitationResend,
  ClientInvitationResendDatabase,
} from '../domain/client-invitation-resends.js'

type ListRow = { list_backoffice_client_invitations: BackofficeClientInvitationList }
type ResendRow = { result: BackofficeClientInvitationResend; replayed: boolean }

export function createClientInvitationResendDatabase(): ClientInvitationResendDatabase {
  const sql = database()

  return {
    list: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<ListRow[]>`
          select identity.list_backoffice_client_invitations(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not list the client invitations')
        return row.list_backoffice_client_invitations
      }),

    resend: (input) =>
      inTransaction(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<ResendRow[]>`
          select * from identity.resend_client_invitation(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.organizationId}::uuid, ${input.invitationId}::uuid,
            ${input.tokenHash}, ${input.tokenKeyVersion}::smallint,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not resend the client invitation')
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
