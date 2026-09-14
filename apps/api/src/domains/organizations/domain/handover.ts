/**
 * Handing an organization Allfit created to its owner: OP-ORG-018, OP-ORG-021 and
 * OP-ORG-022 (`HU-BO-014`, `HU-BO-015`).
 *
 * The rules — the lifecycle duty, which states allow what, who may claim — live in
 * PostgreSQL. What is repeated here is the command's shape, so a malformed body is
 * answered 422 before it reaches the database, and the invitation token, which the
 * database only ever receives hashed.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationHandover = AllfitV1Schemas['OrganizationHandover']
export type OrganizationHandoverCreate = AllfitV1Schemas['OrganizationHandoverCreate']

export interface HandoverActor {
  actorPersonId: string
  actorSessionId: string
}

export interface HandoverCommand {
  requestId: string
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

/** Derived from the command id, so a replayed command sends the same link. */
export interface HandoverToken {
  tokenHash: Uint8Array
  tokenKeyVersion: number
}

export interface HandoverCommandResult {
  resource: OrganizationHandover
  replayed: boolean
}

export interface OrganizationHandoverDatabase {
  create(
    input: HandoverActor &
      HandoverCommand &
      HandoverToken & { handover: OrganizationHandoverCreate },
  ): Promise<HandoverCommandResult>
  read(
    input: HandoverActor & { requestId: string; organizationId: string },
  ): Promise<OrganizationHandover>
  resend(
    input: HandoverActor & HandoverCommand & HandoverToken & { organizationId: string },
  ): Promise<HandoverCommandResult>
  cancel(
    input: HandoverActor & HandoverCommand & { organizationId: string },
  ): Promise<HandoverCommandResult>
}
