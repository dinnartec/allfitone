/**
 * Global catalogue curation use cases.
 *
 * No authorization branch: `curate_global_catalog`, AAL2, the stability of a published
 * code and the refusal to archive a discipline whose content is still published are all
 * resolved inside the command's own transaction.
 */

import type { BackofficeActor } from '../../identity/index.js'
import type { CatalogCommandContext } from '../domain/index.js'
import type {
  BackofficeGlobalCatalogue,
  CatalogueActivityTypePublication,
  CatalogueEntryResult,
  CatalogueMovementPublication,
  CataloguePublication,
  GlobalCatalogueCurationDatabase,
} from '../domain/global-catalogue.js'

export interface GlobalCatalogueCurationService {
  read(actor: BackofficeActor, input: { requestId: string }): Promise<BackofficeGlobalCatalogue>
  publishDiscipline(
    actor: BackofficeActor,
    input: CatalogCommandContext & { publication: CataloguePublication },
  ): Promise<CatalogueEntryResult>
  archiveDiscipline(
    actor: BackofficeActor,
    input: CatalogCommandContext & { code: string },
  ): Promise<CatalogueEntryResult>
  publishActivityType(
    actor: BackofficeActor,
    input: CatalogCommandContext & { publication: CatalogueActivityTypePublication },
  ): Promise<CatalogueEntryResult>
  archiveActivityType(
    actor: BackofficeActor,
    input: CatalogCommandContext & { code: string },
  ): Promise<CatalogueEntryResult>
  publishMovement(
    actor: BackofficeActor,
    input: CatalogCommandContext & { publication: CatalogueMovementPublication },
  ): Promise<CatalogueEntryResult>
  archiveMovement(
    actor: BackofficeActor,
    input: CatalogCommandContext & { movementId: string },
  ): Promise<CatalogueEntryResult>
}

export function createGlobalCatalogueCurationService(
  database: GlobalCatalogueCurationDatabase,
): GlobalCatalogueCurationService {
  const from = (actor: BackofficeActor) => ({
    actorPersonId: actor.personId,
    actorSessionId: actor.sessionId,
  })

  return {
    read: (actor, input) => database.read({ ...from(actor), ...input }),
    publishDiscipline: (actor, input) => database.publishDiscipline({ ...from(actor), ...input }),
    archiveDiscipline: (actor, input) => database.archiveDiscipline({ ...from(actor), ...input }),
    publishActivityType: (actor, input) =>
      database.publishActivityType({ ...from(actor), ...input }),
    archiveActivityType: (actor, input) =>
      database.archiveActivityType({ ...from(actor), ...input }),
    publishMovement: (actor, input) => database.publishMovement({ ...from(actor), ...input }),
    archiveMovement: (actor, input) => database.archiveMovement({ ...from(actor), ...input }),
  }
}
