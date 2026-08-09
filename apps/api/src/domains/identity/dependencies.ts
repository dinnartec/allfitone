/** Identity module composition. */

import { authProvider } from '../../platform/auth/index.js'
import {
  createStudioOnboardingService,
  createStudioSessionService,
  type StudioOnboardingService,
  type StudioSessionService,
} from './application/index.js'
import {
  createSpaceRegistrationService,
  type SpaceRegistrationService,
} from './application/registration.js'
import {
  createIdentityOnboardingDatabase,
  createIdentitySessionDatabase,
  createSessionTokenVaultFromEnv,
} from './infrastructure/index.js'

let cached: StudioSessionService | undefined
let cachedOnboarding: StudioOnboardingService | undefined
let cachedRegistrations: SpaceRegistrationService | undefined

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

/** Test seam. Undefined restores environment-backed construction. */
export function setStudioSessionService(service: StudioSessionService | undefined): void {
  cached = service
}

/**
 * Needs no database and no issuer: account creation touches the provider only.
 */
export function spaceRegistrationService(): SpaceRegistrationService {
  if (cachedRegistrations) return cachedRegistrations
  cachedRegistrations = createSpaceRegistrationService({ authProvider: authProvider() })
  return cachedRegistrations
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceRegistrationService(service: SpaceRegistrationService | undefined): void {
  cachedRegistrations = service
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
