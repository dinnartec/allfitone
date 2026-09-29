import type { AccountActor } from '../../identity/index.js'
import type { ClientDirectoryDatabase, DirectoryPage, DirectoryQuery } from '../domain/index.js'

/**
 * An account that authenticated but never completed activation has no person
 * behind it, so there is no subject for the directory's policy to resolve.
 * Refusing here keeps that distinct from "you may not read this directory".
 */
export class RelationshipsError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'RelationshipsError'
  }
}

export interface ClientDirectoryService {
  listClients(actor: AccountActor, query: DirectoryQuery): Promise<DirectoryPage>
}

/**
 * Thin on purpose. The narrowing a coach gets is a row policy in PostgreSQL,
 * not a branch here: a second copy of "who may see this client" would drift
 * from the first the day either changes.
 */
export function createClientDirectoryService(
  database: ClientDirectoryDatabase,
): ClientDirectoryService {
  const personId = (actor: AccountActor) => {
    if (!actor.personId) throw new RelationshipsError('registration-incomplete')
    return actor.personId
  }

  return {
    listClients: (actor, query) => database.listClients(personId(actor), query),
  }
}
