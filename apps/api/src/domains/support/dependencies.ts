import {
  createPlatformAccessService,
  createSupportDiagnosisService,
  createSupportMetadataService,
  type PlatformAccessService,
  type SupportDiagnosisService,
  type SupportMetadataService,
} from './application/index.js'
import {
  createPlatformAccessDatabase,
  createSupportDiagnosisDatabase,
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

let cachedDiagnosis: SupportDiagnosisService | undefined

export function supportDiagnosisService(): SupportDiagnosisService {
  cachedDiagnosis ??= createSupportDiagnosisService(createSupportDiagnosisDatabase())
  return cachedDiagnosis
}
