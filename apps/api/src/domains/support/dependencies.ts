import {
  createPlatformAccessService,
  createSupportMetadataService,
  type PlatformAccessService,
  type SupportMetadataService,
} from './application/index.js'
import {
  createPlatformAccessDatabase,
  createSupportMetadataDatabase,
} from './infrastructure/index.js'

let cached: PlatformAccessService | undefined

export function platformAccessService(): PlatformAccessService {
  cached ??= createPlatformAccessService(createPlatformAccessDatabase())
  return cached
}

let cachedMetadata: SupportMetadataService | undefined

export function supportMetadataService(): SupportMetadataService {
  cachedMetadata ??= createSupportMetadataService(createSupportMetadataDatabase())
  return cachedMetadata
}
