import type { AccountActor } from '../../identity/index.js'
import type {
  CatalogueTerm,
  Movement,
  MovementDetail,
  MovementLibraryDatabase,
  MovementQuery,
  MuscleTerm,
  Page,
  ProfessionalCatalogDatabase,
} from '../domain/index.js'

export class StudioCatalogError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioCatalogError'
  }
}

export interface StudioCatalogService {
  listSpecialties(actor: AccountActor): ReturnType<ProfessionalCatalogDatabase['listSpecialties']>
  listCredentialTypes(
    actor: AccountActor,
  ): ReturnType<ProfessionalCatalogDatabase['listCredentialTypes']>
}

export function createStudioCatalogService(
  database: ProfessionalCatalogDatabase,
): StudioCatalogService {
  const personId = (actor: AccountActor) => {
    if (!actor.personId) throw new StudioCatalogError('registration-incomplete')
    return actor.personId
  }

  return {
    listSpecialties: (actor) => database.listSpecialties(personId(actor)),
    listCredentialTypes: (actor) => database.listCredentialTypes(personId(actor)),
  }
}

export interface MovementLibraryService {
  search(request: MovementQuery): Promise<Page<Movement>>
  read(input: { personId: string; movementId: string }): Promise<MovementDetail | null>
  equipment(personId: string): Promise<CatalogueTerm[]>
  muscles(personId: string): Promise<MuscleTerm[]>
}

/**
 * Where the demonstrations are served from, which is configuration and not data.
 *
 * The database stores an object key precisely so that moving origin is a variable
 * rather than a migration; this is the only place that knows the other half.
 */
export interface MovementLibraryDependencies {
  database: MovementLibraryDatabase
  mediaBaseUrl: string
}

export function createMovementLibraryService({
  database,
  mediaBaseUrl,
}: MovementLibraryDependencies): MovementLibraryService {
  const base = mediaBaseUrl.replace(/\/+$/, '')
  const address = (key: string | null): string | null => (key === null ? null : `${base}/${key}`)

  return {
    search: async (request) => {
      const found = await database.readMovements(request)
      return {
        data: found.data.map(({ demo_object_key, ...rest }) => ({
          ...rest,
          demo_url: address(demo_object_key),
        })),
        page: found.page,
      }
    },
    read: async (input) => {
      const found = await database.readMovement(input)
      if (!found) return null
      const { demo_object_key, ...rest } = found
      return { ...rest, demo_url: address(demo_object_key) }
    },
    equipment: (personId) => database.readEquipment(personId),
    muscles: (personId) => database.readMuscles(personId),
  }
}
