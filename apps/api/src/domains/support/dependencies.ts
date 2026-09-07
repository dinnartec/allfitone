import { createPlatformAccessService, type PlatformAccessService } from './application/index.js'
import { createPlatformAccessDatabase } from './infrastructure/index.js'

let cached: PlatformAccessService | undefined

export function platformAccessService(): PlatformAccessService {
  cached ??= createPlatformAccessService(createPlatformAccessDatabase())
  return cached
}
