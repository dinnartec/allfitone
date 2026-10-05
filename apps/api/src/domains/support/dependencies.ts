import {
  createBreakGlassService,
  createPlatformAccessService,
  createSupportAttentionService,
  createSupportBusinessService,
  createSupportDiagnosisService,
  createSupportMetadataService,
  type BreakGlassService,
  type PlatformAccessService,
  type SupportAttentionService,
  type SupportBusinessService,
  type SupportDiagnosisService,
  type SupportMetadataService,
} from './application/index.js'
import {
  createBreakGlassDatabase,
  createPlatformAccessDatabase,
  createSupportAttentionDatabase,
  createSupportBusinessDatabase,
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

let cachedAttention: SupportAttentionService | undefined

export function supportAttentionService(): SupportAttentionService {
  cachedAttention ??= createSupportAttentionService(createSupportAttentionDatabase())
  return cachedAttention
}

let cachedBusiness: SupportBusinessService | undefined

export function supportBusinessService(): SupportBusinessService {
  cachedBusiness ??= createSupportBusinessService(createSupportBusinessDatabase())
  return cachedBusiness
}

let cachedBreakGlass: BreakGlassService | undefined

export function breakGlassService(): BreakGlassService {
  cachedBreakGlass ??= createBreakGlassService(createBreakGlassDatabase())
  return cachedBreakGlass
}
