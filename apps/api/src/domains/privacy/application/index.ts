/**
 * Scope publication use cases.
 *
 * There is no authorization branch here on purpose: `curate_global_catalog`,
 * AAL2 and the effective assignment are resolved inside the command's own
 * transaction. This layer carries the curator through and nothing else.
 */

import type {
  GrantRevocation,
  MyConsent,
  MyConsentCommand,
  MyConsentDatabase,
  OfferableScope,
  OfferableScopeDatabase,
  AccessEventFilters,
  AccessEventPage,
  AccessLogDatabase,
  ErasureRequestDatabase,
  ErasureRequestFilters,
  ErasureRequestPage,
  LegalHoldApplication,
  LegalHoldDatabase,
  LegalHoldResult,
  PrivacyCurator,
  ScopeCommandContext,
  ScopeCommandResult,
  ScopeDefinition,
  ScopeDefinitionDatabase,
  ScopeDefinitionPublication,
  AuthorizedScope,
  AuthorizedScopeDatabase,
  AuthorizedScopeQuery,
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

export interface LegalHoldService {
  apply(
    officer: PrivacyCurator,
    input: ScopeCommandContext & { requestId: string; application: LegalHoldApplication },
  ): Promise<LegalHoldResult>
  release(
    officer: PrivacyCurator,
    input: ScopeCommandContext & { requestId: string; holdId: string },
  ): Promise<LegalHoldResult>
}

export function createLegalHoldService(database: LegalHoldDatabase): LegalHoldService {
  return {
    apply: (officer, input) => database.apply({ ...officer, ...input }),
    release: (officer, input) => database.release({ ...officer, ...input }),
  }
}

export interface ErasureRequestService {
  list(
    officer: PrivacyCurator,
    input: { requestId: string } & ErasureRequestFilters,
  ): Promise<ErasureRequestPage>
}

export function createErasureRequestService(
  database: ErasureRequestDatabase,
): ErasureRequestService {
  return {
    list: (officer, input) => database.list({ ...officer, ...input }),
  }
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

export interface OfferableScopeService {
  list(input: { actorPersonId: string; requestId: string }): Promise<OfferableScope[]>
}

/*
 * No authorization branch, deliberately. Who may read this is decided in
 * PostgreSQL — `list_offerable_scopes` answers a person actor and nobody else —
 * and a second answer here could disagree with the one that decides.
 */
export function createOfferableScopeService(
  database: OfferableScopeDatabase,
): OfferableScopeService {
  return {
    list: (input) => database.listOfferable(input),
  }
}

/*
 * `OP-PRV-013` and `OP-PRV-005` for the person. Whose grant it is, and whether it
 * can still be revoked, is decided in PostgreSQL; nothing here second-guesses it.
 */
export interface MyConsentService {
  listMine(personId: string): Promise<MyConsent[]>
  revoke(command: MyConsentCommand): Promise<{ resource: GrantRevocation; replayed: boolean }>
}

export function createMyConsentService(database: MyConsentDatabase): MyConsentService {
  return {
    listMine: (personId) => database.listMine(personId),
    revoke: (command) => database.revoke(command),
  }
}

/*
 * `OP-PRV-023` for the organization. Which clients the reader may count is
 * decided by the relationship's own row policy inside the transaction, so there
 * is no authorization branch here: this layer carries the reader through and
 * nothing else.
 */
export interface AuthorizedScopeService {
  list(
    personId: string,
    query: AuthorizedScopeQuery,
  ): Promise<{ items: AuthorizedScope[]; hasMore: boolean }>
}

export function createAuthorizedScopeService(
  database: AuthorizedScopeDatabase,
): AuthorizedScopeService {
  return {
    list: (personId, query) => database.list(personId, query),
  }
}
