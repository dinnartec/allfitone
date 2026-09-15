/** Identity module composition. */

import { authProvider } from '../../platform/auth/index.js'
import {
  createBackofficeAuthenticationService,
  type BackofficeAuthenticationService,
} from './application/backoffice.js'
import {
  createStudioInvitationService,
  type StudioInvitationService,
} from './application/invitations.js'
import {
  createOnboardingService,
  createStudioProfessionalService,
  createStudioSessionService,
  type OnboardingService,
  type StudioProfessionalService,
  type StudioSessionService,
} from './application/index.js'
import {
  createIdentityWebhookService,
  type IdentityWebhookService,
} from './application/webhooks.js'
import {
  createSpaceOnboardingService,
  type SpaceOnboardingService,
} from './application/onboarding.js'
import {
  createSpaceRegistrationService,
  type SpaceRegistrationService,
} from './application/registration.js'
import {
  createCredentialVerificationService,
  type CredentialVerificationService,
} from './application/credential-verification.js'
import {
  createIdentityOnboardingDatabase,
  createIdentityProfessionalDatabase,
  createIdentitySessionDatabase,
  createIdentityWebhookDatabase,
  createIdentityInvitationDatabase,
  createBackofficeAuthenticationDatabase,
  createSessionTokenVaultFromEnv,
} from './infrastructure/index.js'
import { createCredentialVerificationDatabase } from './infrastructure/credential-verification.js'
import {
  createStudioOwnershipInvitationService,
  type StudioOwnershipInvitationService,
} from './application/ownership-invitations.js'
import { createOwnershipInvitationDatabase } from './infrastructure/ownership-invitations.js'
import {
  createTeamInvitationResendService,
  type TeamInvitationResendService,
} from './application/team-invitation-resends.js'
import { createTeamInvitationResendDatabase } from './infrastructure/team-invitation-resends.js'

let cachedOwnership: StudioOwnershipInvitationService | undefined

export function studioOwnershipInvitationService(): StudioOwnershipInvitationService {
  cachedOwnership ??= createStudioOwnershipInvitationService(createOwnershipInvitationDatabase())
  return cachedOwnership
}

let cachedResends: TeamInvitationResendService | undefined

export function teamInvitationResendService(): TeamInvitationResendService {
  cachedResends ??= createTeamInvitationResendService(createTeamInvitationResendDatabase())
  return cachedResends
}

let cached: StudioSessionService | undefined
let cachedOnboarding: OnboardingService | undefined
let cachedProfessional: StudioProfessionalService | undefined
let cachedRegistrations: SpaceRegistrationService | undefined
let cachedSpaceOnboarding: SpaceOnboardingService | undefined
let cachedWebhooks: IdentityWebhookService | undefined
let cachedInvitations: StudioInvitationService | undefined
let cachedBackoffice: BackofficeAuthenticationService | undefined
let cachedVerification: CredentialVerificationService | undefined

export function credentialVerificationService(): CredentialVerificationService {
  cachedVerification ??= createCredentialVerificationService(createCredentialVerificationDatabase())
  return cachedVerification
}

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

export function studioOnboardingService(): OnboardingService {
  cachedOnboarding ??= createOnboardingService(createIdentityOnboardingDatabase())
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

/**
 * Needs no database and no issuer: account creation touches the provider only.
 */
export function spaceRegistrationService(): SpaceRegistrationService {
  if (cachedRegistrations) return cachedRegistrations
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedRegistrations = createSpaceRegistrationService({ authProvider: authProvider(), issuer })
  return cachedRegistrations
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceRegistrationService(service: SpaceRegistrationService | undefined): void {
  cachedRegistrations = service
}

export function spaceOnboardingService(): SpaceOnboardingService {
  if (cachedSpaceOnboarding) return cachedSpaceOnboarding
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedSpaceOnboarding = createSpaceOnboardingService({
    accounts: createIdentitySessionDatabase(),
    onboarding: studioOnboardingService(),
    issuer,
  })
  return cachedSpaceOnboarding
}

/** Test seam. Undefined restores environment-backed construction. */
export function setSpaceOnboardingService(service: SpaceOnboardingService | undefined): void {
  cachedSpaceOnboarding = service
}

export function identityWebhookService(): IdentityWebhookService {
  if (cachedWebhooks) return cachedWebhooks
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedWebhooks = createIdentityWebhookService({
    authProvider: authProvider(),
    database: createIdentityWebhookDatabase(),
    issuer,
  })
  return cachedWebhooks
}

export function studioInvitationService(): StudioInvitationService {
  cachedInvitations ??= createStudioInvitationService(createIdentityInvitationDatabase(), {
    enabled: process.env.STAFF_INVITATION_ISSUANCE_ENABLED === 'true',
  })
  return cachedInvitations
}

export function backofficeAuthenticationService(): BackofficeAuthenticationService {
  if (cachedBackoffice) return cachedBackoffice
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedBackoffice = createBackofficeAuthenticationService({
    authProvider: authProvider(),
    database: createBackofficeAuthenticationDatabase(),
    tokenVault: createSessionTokenVaultFromEnv(),
    issuer,
  })
  return cachedBackoffice
}

/** Test seam. Undefined restores environment-backed construction. */
export function setBackofficeAuthenticationService(
  service: BackofficeAuthenticationService | undefined,
): void {
  cachedBackoffice = service
}

export function trustedBackofficeWebUrl(): string {
  const configured = process.env.BACKOFFICE_WEB_URL
  if (!configured) throw new Error('BACKOFFICE_WEB_URL is not set')
  const url = new URL(configured)
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'BACKOFFICE_WEB_URL must be a trusted URL without credentials, query or fragment',
    )
  }
  return url.toString().replace(/\/$/, '')
}

/** Test seam. Undefined restores environment-backed construction. */
export function setStudioInvitationService(service: StudioInvitationService | undefined): void {
  cachedInvitations = service
}

/** Test seam. Undefined restores environment-backed construction. */
export function setIdentityWebhookService(service: IdentityWebhookService | undefined): void {
  cachedWebhooks = service
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
