import type { ClientDirectoryDatabase, DirectoryPage, DirectoryQuery } from '../domain/index.js'

export interface ClientDirectoryService {
  listClients(personId: string, query: DirectoryQuery): Promise<DirectoryPage>
}

/**
 * A pass-through today, and deliberately so. The narrowing a coach gets is a
 * row policy in PostgreSQL, not a branch here: duplicating it would create a
 * second answer to "who may see this client" that drifts from the first.
 */
export function createClientDirectoryService(
  database: ClientDirectoryDatabase,
): ClientDirectoryService {
  return {
    listClients: (personId, query) => database.listClients(personId, query),
  }
}
