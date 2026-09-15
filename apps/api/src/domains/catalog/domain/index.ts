export interface ProfessionalCatalogItem {
  code: string
  name: string
  description: string | null
}

export interface ProfessionalCatalogDatabase {
  listSpecialties(personId: string): Promise<ProfessionalCatalogItem[]>
  listCredentialTypes(personId: string): Promise<ProfessionalCatalogItem[]>
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
