/** Identity module composition. */

import { authProvider } from '../../platform/auth/index.js'
import {
  createStudioOnboardingService,
  createStudioProfessionalService,
  createStudioSessionService,
  type StudioOnboardingService,
  type StudioProfessionalService,
  type StudioSessionService,
} from './application/index.js'
import {
  createIdentityOnboardingDatabase,
  createIdentityProfessionalDatabase,
  createIdentitySessionDatabase,
  createSessionTokenVaultFromEnv,
} from './infrastructure/index.js'

let cached: StudioSessionService | undefined
let cachedOnboarding: StudioOnboardingService | undefined
let cachedProfessional: StudioProfessionalService | undefined

export function studioSessionService(): StudioSessionService {
  if (cached) return cached

  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  const studioWebUrl = trustedStudioWebUrl()
  cached = createStudioSessionService({
    authProvider: authProvider(),
    database: createIdentitySessionDatabase(),
    tokenVault: createSessionTokenVaultFromEnv(),
    issuer,
    studioWebUrl,
  })
  return cached
}

export function studioOnboardingService(): StudioOnboardingService {
  cachedOnboarding ??= createStudioOnboardingService(createIdentityOnboardingDatabase())
  return cachedOnboarding
}

export function studioProfessionalService(): StudioProfessionalService {
  cachedProfessional ??= createStudioProfessionalService(createIdentityProfessionalDatabase())
  return cachedProfessional
}

/** Test seam. Undefined restores environment-backed construction. */
export function setStudioSessionService(service: StudioSessionService | undefined): void {
  cached = service
}

export function trustedStudioWebUrl(): string {
  const configured = process.env.STUDIO_WEB_URL
  if (!configured) throw new Error('STUDIO_WEB_URL is not set')
  const url = new URL(configured)
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('STUDIO_WEB_URL must be a trusted URL without credentials, query or fragment')
  }
  return url.toString().replace(/\/$/, '')
}
