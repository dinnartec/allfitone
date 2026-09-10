import type { AccountActor, BackofficeActor } from '../../identity/index.js'
import type {
  ActivityTypeResultContract,
  CatalogActivityType,
  CatalogCommandContext,
  CatalogDiscipline,
  CatalogReader,
  GlobalCatalogDatabase,
  CatalogCommandResult,
  ProfessionalCatalogDatabase,
  ResultContract,
  ResultContractDatabase,
  ResultContractPublication,
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

/**
 * Result contract curation.
 *
 * There is no authorization branch here on purpose: `curate_global_catalog`,
 * AAL2 and the fixture requirement are resolved inside the command's own
 * transaction. A second answer in this layer could disagree with the one that
 * decides.
 */
export interface ResultContractService {
  publish(
    actor: BackofficeActor,
    input: CatalogCommandContext & { publication: ResultContractPublication },
  ): Promise<CatalogCommandResult<ResultContract>>
  deprecate(
    actor: BackofficeActor,
    input: CatalogCommandContext & { contractId: string },
  ): Promise<CatalogCommandResult<ResultContract>>
}

export function createResultContractService(
  database: ResultContractDatabase,
): ResultContractService {
  const from = (actor: BackofficeActor) => ({
    actorPersonId: actor.personId,
    actorSessionId: actor.sessionId,
  })
  return {
    publish: (actor, input) => database.publish({ ...from(actor), ...input }),
    deprecate: (actor, input) => database.deprecate({ ...from(actor), ...input }),
  }
}

/**
 * Global catalogue reads.
 *
 * There is no authorization branch here: the database refuses a caller that is
 * not an active person, and the read policies refuse anything unpublished or
 * organisation-scoped. This layer only carries the reader through.
 */
export interface GlobalCatalogService {
  listDisciplines(reader: CatalogReader): Promise<CatalogDiscipline[]>
  listActivityTypes(reader: CatalogReader): Promise<CatalogActivityType[]>
  listActivityTypeResultContracts(
    reader: CatalogReader,
    activityTypeId: string,
  ): Promise<ActivityTypeResultContract[]>
}

export function createGlobalCatalogService(database: GlobalCatalogDatabase): GlobalCatalogService {
  return {
    listDisciplines: (reader) => database.listDisciplines(reader),
    listActivityTypes: (reader) => database.listActivityTypes(reader),
    listActivityTypeResultContracts: (reader, activityTypeId) =>
      database.listActivityTypeResultContracts(reader, activityTypeId),
  }
}
