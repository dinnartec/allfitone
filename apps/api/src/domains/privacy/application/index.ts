/**
 * Scope publication use cases.
 *
 * There is no authorization branch here on purpose: `curate_global_catalog`,
 * AAL2 and the effective assignment are resolved inside the command's own
 * transaction. This layer carries the curator through and nothing else.
 */

import type {
  AccessEventFilters,
  AccessEventPage,
  AccessLogDatabase,
  PrivacyCurator,
  ScopeCommandContext,
  ScopeCommandResult,
  ScopeDefinition,
  ScopeDefinitionDatabase,
  ScopeDefinitionPublication,
} from '../domain/index.js'

export interface ScopeDefinitionService {
  publish(
    curator: PrivacyCurator,
    input: ScopeCommandContext & { publication: ScopeDefinitionPublication },
  ): Promise<ScopeCommandResult>
  list(curator: PrivacyCurator, input: { requestId: string }): Promise<ScopeDefinition[]>
}

export interface AccessLogService {
  read(
    auditor: PrivacyCurator,
    input: { requestId: string } & AccessEventFilters,
  ): Promise<AccessEventPage>
}

export function createAccessLogService(database: AccessLogDatabase): AccessLogService {
  return {
    read: (auditor, input) => database.read({ ...auditor, ...input }),
  }
}

export function createScopeDefinitionService(
  database: ScopeDefinitionDatabase,
): ScopeDefinitionService {
  return {
    publish: (curator, input) => database.publish({ ...curator, ...input }),
    list: (curator, input) => database.list({ ...curator, ...input }),
  }
}
