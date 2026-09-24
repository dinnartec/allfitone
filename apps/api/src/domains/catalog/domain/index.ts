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

export interface Movement {
  id: string
  discipline_code: string
  name: string
  muscles: string[]
  equipment: string[]
  /** Absolute, composed from configuration. Null where none has been curated. */
  demo_url: string | null
}

/** What the database answers: a key. The origin is configuration, not data. */
export interface StoredMovement extends Omit<Movement, 'demo_url'> {
  demo_object_key: string | null
}

/** One page of the library, and where to continue from. */
export interface Page<T> {
  data: T[]
  page: { next_cursor: string | null; has_more: boolean }
}

/** The cursor was not a shape the database could make sense of. */
export class MovementCursorError extends Error {
  constructor() {
    super('invalid-cursor')
    this.name = 'MovementCursorError'
  }
}

/** The detail names its muscles and says which are primary; the list only codes them. */
export interface DetailMuscle {
  code: string
  name: string
  primary: boolean
}

export interface CatalogueTerm {
  code: string
  name: string
}

export interface MuscleTerm extends CatalogueTerm {
  region: string
  body_slug: string | null
}

export interface MovementQuery {
  personId: string
  discipline: string | null
  query: string | null
  /** Several values are `or`; combining with `equipment` is `and`. */
  muscles: string[]
  equipment: string[]
  limit: number
  /** Opaque. A client that parsed it would depend on today's order. */
  cursor: string | null
}

export interface MovementDetail extends Omit<Movement, 'muscles'> {
  muscles: DetailMuscle[]
  aliases: string[]
  instructions: { position: number; text: string }[]
  variants: { id: string; name: string; relation: string; note: string | null }[]
}

export interface StoredMovementDetail extends Omit<MovementDetail, 'demo_url'> {
  demo_object_key: string | null
}

export interface MovementLibraryDatabase {
  readMovements(request: MovementQuery): Promise<Page<StoredMovement>>
  /** Null when nobody can see it, which is the same answer as not existing. */
  readMovement(input: {
    personId: string
    movementId: string
  }): Promise<StoredMovementDetail | null>
  readEquipment(personId: string): Promise<CatalogueTerm[]>
  readMuscles(personId: string): Promise<MuscleTerm[]>
}
