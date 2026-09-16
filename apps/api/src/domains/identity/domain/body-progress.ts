/**
 * A person's body measurements: `OP-IDN-006`, `OP-IDN-007`, `OP-IDN-015`.
 *
 * The vocabularies are repeated here only so a malformed request is answered 422 before it
 * reaches the database. Which person the token belongs to, the conversion to the canonical
 * unit, and the disposition a deletion leaves behind are all decided in PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BodyProgressRecord = AllfitV1Schemas['BodyProgressRecord']
export type BodyProgressRecordCreate = AllfitV1Schemas['BodyProgressRecordCreate']
export type BodyProgressPage = AllfitV1Schemas['BodyProgressPage']
export type BodyProgressDeletion = AllfitV1Schemas['BodyProgressDeletion']
export type BodyProgressMetricCode = AllfitV1Schemas['BodyProgressMetricCode']
export type BodyProgressUnitCode = AllfitV1Schemas['BodyProgressUnitCode']

export const BODY_PROGRESS_METRICS: readonly BodyProgressMetricCode[] = [
  'weight',
  'muscle_mass',
  'body_fat',
  'waist',
  'hip',
  'chest',
  'arm',
  'thigh',
]

export const BODY_PROGRESS_UNITS: readonly BodyProgressUnitCode[] = [
  'kg',
  'lb',
  'm',
  'cm',
  'in',
  'percent',
]

export const MAX_BODY_PROGRESS_VALUE = 100_000
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
  record(
    input: BodyProgressHolder &
      BodyProgressCommand & { recordId: string; measurement: BodyProgressRecordCreate },
  ): Promise<BodyProgressResult<BodyProgressRecord>>
  delete(
    input: BodyProgressHolder & BodyProgressCommand & { recordId: string },
  ): Promise<BodyProgressResult<BodyProgressDeletion>>
}
