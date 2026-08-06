/**
 * Contract shared between the API and its three clients.
 *
 * `openapi/` is the canonical executable specification and is edited by hand.
 * `generated/` is produced from it and is NEVER edited directly.
 *
 * The specification, generated DTOs, API and clients travel together in one
 * monorepo commit. Product and architecture context remains in allfitone-docs.
 */
import type { components, operations, paths } from '../generated/allfit-v1.js'

export { allfitV1ContractManifest } from '../generated/allfit-v1-manifest.js'

export type AllfitV1Paths = paths
export type AllfitV1Operations = operations
export type AllfitV1Schemas = components['schemas']
