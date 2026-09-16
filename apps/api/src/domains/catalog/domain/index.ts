/**
 * The governed catalogue: what Studio may read, and what Allfit staff publish.
 *
 * A result contract says what a session must carry to count as complete. It is
 * published, never edited — an execution freezes the contract and version it was
 * validated against, so a correction is a new version and not a rewrite of what
 * anyone already recorded.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ResultContract = AllfitV1Schemas['ResultContract']
export type ResultContractPublication = AllfitV1Schemas['ResultContractPublication']
export type ActivityFamily = AllfitV1Schemas['ActivityFamily']

export const ACTIVITY_FAMILIES: readonly ActivityFamily[] = [
  'strength',
  'endurance',
  'interval',
  'mobility',
]

export interface CatalogCommandContext {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface CatalogCommandResult<T> {
  resource: T
  replayed: boolean
}

export interface ResultContractDatabase {
  publish(
    input: CatalogCommandContext & {
      actorPersonId: string
      actorSessionId: string
      publication: ResultContractPublication
    },
  ): Promise<CatalogCommandResult<ResultContract>>
  deprecate(
    input: CatalogCommandContext & {
      actorPersonId: string
      actorSessionId: string
      contractId: string
    },
  ): Promise<CatalogCommandResult<ResultContract>>
}

export interface ProfessionalCatalogItem {
  code: string
  name: string
  description: string | null
}

export interface ProfessionalCatalogDatabase {
  listSpecialties(personId: string): Promise<ProfessionalCatalogItem[]>
  listCredentialTypes(personId: string): Promise<ProfessionalCatalogItem[]>
}

/**
 * The global catalogue: published content with no tenant and no subject, read by
 * every surface. `CatalogReader` carries the actor kind because the same rows are
 * read by a person in Studio and by a support actor in Backoffice, and the audit
 * context should say which.
 */
export type CatalogDiscipline = AllfitV1Schemas['CatalogDiscipline']
export type CatalogActivityType = AllfitV1Schemas['CatalogActivityType']
export type ActivityTypeResultContract = AllfitV1Schemas['ActivityTypeResultContract']

export interface CatalogReader {
  personId: string
  actorKind: 'person' | 'support'
}

export interface GlobalCatalogDatabase {
  listDisciplines(reader: CatalogReader): Promise<CatalogDiscipline[]>
  listActivityTypes(reader: CatalogReader): Promise<CatalogActivityType[]>
  listActivityTypeResultContracts(
    reader: CatalogReader,
    activityTypeId: string,
  ): Promise<ActivityTypeResultContract[]>
}
