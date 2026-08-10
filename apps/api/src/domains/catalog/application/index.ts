import type { StudioActor } from '../../identity/index.js'
import type { ProfessionalCatalogDatabase } from '../domain/index.js'

export class StudioCatalogError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'StudioCatalogError'
  }
}

export interface StudioCatalogService {
  listSpecialties(actor: StudioActor): ReturnType<ProfessionalCatalogDatabase['listSpecialties']>
  listCredentialTypes(
    actor: StudioActor,
  ): ReturnType<ProfessionalCatalogDatabase['listCredentialTypes']>
}

export function createStudioCatalogService(
  database: ProfessionalCatalogDatabase,
): StudioCatalogService {
  const personId = (actor: StudioActor) => {
    if (!actor.personId) throw new StudioCatalogError('registration-incomplete')
    return actor.personId
  }

  return {
    listSpecialties: (actor) => database.listSpecialties(personId(actor)),
    listCredentialTypes: (actor) => database.listCredentialTypes(personId(actor)),
  }
}
