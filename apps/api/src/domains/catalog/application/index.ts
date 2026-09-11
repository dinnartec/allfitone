import type { AccountActor } from '../../identity/index.js'
import type {
  CatalogueTerm,
  Movement,
  MovementLibraryDatabase,
  MovementQuery,
  MuscleTerm,
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
  search(request: MovementQuery): Promise<Movement[]>
  equipment(personId: string): Promise<CatalogueTerm[]>
  muscles(personId: string): Promise<MuscleTerm[]>
}

export function createMovementLibraryService(
  database: MovementLibraryDatabase,
): MovementLibraryService {
  return {
    search: (request) => database.readMovements(request),
    equipment: (personId) => database.readEquipment(personId),
    muscles: (personId) => database.readMuscles(personId),
  }
}
