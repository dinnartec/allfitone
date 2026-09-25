/**
 * A person's body measurements: `OP-IDN-007` and `OP-IDN-015`.
 *
 * Recording is `OP-IDN-006` and belongs to onboarding. Which person the token belongs to
 * and the disposition a deletion leaves behind are both decided in PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BodyProgressPage = AllfitV1Schemas['BodyProgressPage']
export type BodyProgressDeletion = AllfitV1Schemas['BodyProgressDeletion']

export const MAX_BODY_PROGRESS_PAGE = 200

export interface BodyProgressCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface BodyProgressResult<T> {
  resource: T
  replayed: boolean
}

export interface BodyProgressHolder {
  issuer: string
  subject: string
}

export interface BodyProgressListInput {
  limit: number
  beforeMeasuredOn?: string
  beforeId?: string
}

export interface BodyProgressDatabase {
  list(
    input: BodyProgressHolder & BodyProgressListInput & { requestId: string },
  ): Promise<BodyProgressPage>
  delete(
    input: BodyProgressHolder & BodyProgressCommand & { recordId: string },
  ): Promise<BodyProgressResult<BodyProgressDeletion>>
}
