/**
 * Published permission definitions: what a person is agreeing to.
 *
 * A scope version says which resources and fields a permission covers, and which
 * it excludes. Nothing here re-implements the rules that make that safe — the
 * immutability of a published version, the server-assigned version number, the
 * refusal of a version that includes nothing — because all of them live in
 * PostgreSQL and a second answer in this layer could disagree with the one that
 * decides.
 *
 * The one thing worth repeating here is the closed vocabulary, so a malformed
 * request is answered 422 rather than becoming a database error.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ScopeDefinition = AllfitV1Schemas['ScopeDefinition']
export type ScopeDefinitionPublication = AllfitV1Schemas['ScopeDefinitionPublication']
export type ScopeResourceRule = AllfitV1Schemas['ScopeResourceRule']
export type ScopeCode = AllfitV1Schemas['ScopeCode']
export type AccessLevel = AllfitV1Schemas['AccessLevel']
export type AccessEvent = AllfitV1Schemas['AccessEvent']
export type AccessEventPage = AllfitV1Schemas['AccessEventPage']
export type ErasureRequest = AllfitV1Schemas['ErasureRequest']
export type ErasureRequestPage = AllfitV1Schemas['ErasureRequestPage']
export type ErasureRequestState = AllfitV1Schemas['ErasureRequestState']

export const SCOPE_CODES: readonly ScopeCode[] = [
  'relationship_training',
  'prior_training_history',
  'body_progress',
  'health_context',
  'nutrition_intake',
  'nutrition_guidance',
  'nutrition_media',
]

export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'contribute']

/** The sensitivity catalogue seeded by the privacy migration. */
export const DATA_CLASSIFICATIONS: readonly string[] = [
  'operational',
  'audit',
  'identity_pii',
  'training',
  'body',
  'nutrition',
  'health',
]

export interface PrivacyCurator {
  actorPersonId: string
  actorSessionId: string
}

export interface ScopeCommandContext {
  idempotencyKey: string
  commandId: string
  requestId: string
  requestHash: Buffer
}

export interface ScopeCommandResult {
  resource: ScopeDefinition
  replayed: boolean
}

/**
 * What an auditor may narrow the log by. Every filter is resolved in the
 * database — a filter applied after the rows arrive would mean reading more of
 * the log than the question needed.
 */
export interface AccessEventFilters {
  filterActorPersonId?: string | undefined
  filterSubjectPersonId?: string | undefined
  from?: string | undefined
  to?: string | undefined
  limit?: number | undefined
}

export const ERASURE_REQUEST_STATES: readonly ErasureRequestState[] = ['open', 'closed']

export const MAX_ERASURE_PAGE = 100
export const DEFAULT_ERASURE_PAGE = 25

export interface ErasureRequestCursor {
  at: string
  id: string
}

export interface ErasureRequestFilters {
  status: ErasureRequestState
  limit: number
  cursor?: ErasureRequestCursor | undefined
}

export interface ErasureRequestDatabase {
  list(
    input: PrivacyCurator & { requestId: string } & ErasureRequestFilters,
  ): Promise<ErasureRequestPage>
}

export interface AccessLogDatabase {
  read(input: PrivacyCurator & { requestId: string } & AccessEventFilters): Promise<AccessEventPage>
}

export interface ScopeDefinitionDatabase {
  publish(
    input: PrivacyCurator & ScopeCommandContext & { publication: ScopeDefinitionPublication },
  ): Promise<ScopeCommandResult>
  list(input: PrivacyCurator & { requestId: string }): Promise<ScopeDefinition[]>
}
