/**
 * A person's health context: `OP-IDN-008`, `OP-IDN-049`, `OP-IDN-050`.
 *
 * The vocabularies are repeated here only so a malformed request is answered 422 before it
 * reaches the database. Which person the token belongs to, the provenance of a claim and
 * the disposition a deletion leaves behind are all decided in PostgreSQL.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type {
  BodyProgressCommand,
  BodyProgressHolder,
  BodyProgressResult,
} from './body-progress.js'

export type HealthContextClaim = AllfitV1Schemas['HealthContextClaim']
export type HealthContextPage = AllfitV1Schemas['HealthContextPage']
export type HealthContextDeletion = AllfitV1Schemas['HealthContextDeletion']
export type HealthContextType = AllfitV1Schemas['HealthContextType']
export type HealthContextBodyArea = AllfitV1Schemas['HealthContextBodyArea']

/** What travels to the database: absent optional fields are null, never missing. */
export interface HealthContextDeclaration {
  context_type: HealthContextType
  description: string
  body_area: HealthContextBodyArea | null
  valid_from: string
  valid_to: string | null
}

export const HEALTH_CONTEXT_TYPES: readonly HealthContextType[] = ['pain', 'limitation', 'recovery']

export const HEALTH_CONTEXT_BODY_AREAS: readonly HealthContextBodyArea[] = [
  'neck',
  'shoulder',
  'upper_back',
  'lower_back',
  'chest',
  'abdomen',
  'arm',
  'elbow',
  'wrist_hand',
  'hip',
  'thigh',
  'knee',
  'lower_leg',
  'ankle_foot',
]

export const MAX_HEALTH_CONTEXT_DESCRIPTION = 500
export const MAX_HEALTH_CONTEXT_PAGE = 200

// A command, a holder and a result are the same shape for every kind of personal data.
export type HealthContextCommand = BodyProgressCommand
export type HealthContextHolder = BodyProgressHolder
export type HealthContextResult<T> = BodyProgressResult<T>

export interface HealthContextListInput {
  limit: number
  beforeValidFrom?: string
  beforeId?: string
}

export interface HealthContextDatabase {
  list(
    input: HealthContextHolder & HealthContextListInput & { requestId: string },
  ): Promise<HealthContextPage>
  declare(
    input: HealthContextHolder &
      HealthContextCommand & { claimId: string; claim: HealthContextDeclaration },
  ): Promise<HealthContextResult<HealthContextClaim>>
  delete(
    input: HealthContextHolder & HealthContextCommand & { claimId: string },
  ): Promise<HealthContextResult<HealthContextDeletion>>
}
