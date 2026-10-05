/**
 * Curating the global catalogue: `NEW-CAT-GLOBAL-PUBLISH`, `OP-CAT-004`, `OP-CAT-005`.
 *
 * `HU-BO-022`. A publication carries a code and a name and nothing else — no scope and no
 * owner — because what Allfit publishes is global by construction and a gym's private
 * content must never be reachable from here.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type { CatalogCommandContext, CatalogCommandResult } from './index.js'

export type BackofficeGlobalCatalogue = AllfitV1Schemas['BackofficeGlobalCatalogue']
export type GlobalCatalogueEntry = AllfitV1Schemas['GlobalCatalogueEntry']
export type CataloguePublication = AllfitV1Schemas['CataloguePublication']
export type CatalogueActivityTypePublication = AllfitV1Schemas['CatalogueActivityTypePublication']
export type CatalogueMovementPublication = AllfitV1Schemas['CatalogueMovementPublication']

export interface CatalogueCurator {
  actorPersonId: string
  actorSessionId: string
}

type Command<T> = CatalogCommandContext & CatalogCurationInput<T>
type CatalogCurationInput<T> = { actorPersonId: string; actorSessionId: string } & T

export type CatalogueEntryResult = CatalogCommandResult<GlobalCatalogueEntry>

export interface GlobalCatalogueCurationDatabase {
  read(input: CatalogueCurator & { requestId: string }): Promise<BackofficeGlobalCatalogue>
  publishDiscipline(
    input: Command<{ publication: CataloguePublication }>,
  ): Promise<CatalogueEntryResult>
  archiveDiscipline(input: Command<{ code: string }>): Promise<CatalogueEntryResult>
  publishActivityType(
    input: Command<{ publication: CatalogueActivityTypePublication }>,
  ): Promise<CatalogueEntryResult>
  archiveActivityType(input: Command<{ code: string }>): Promise<CatalogueEntryResult>
  publishMovement(
    input: Command<{ publication: CatalogueMovementPublication }>,
  ): Promise<CatalogueEntryResult>
  archiveMovement(input: Command<{ movementId: string }>): Promise<CatalogueEntryResult>
}
