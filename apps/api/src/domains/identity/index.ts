/**
 * Public interface of the identity domain.
 *
 * Everything outside this module reaches identity through here and nowhere
 * else — the boundary rules enforce it. Reaching into `handlers/` or
 * `infrastructure/` from outside would couple callers to internals that are
 * meant to move freely.
 */

export { studioIdentityRoutes } from './handlers/studio.js'
export { STUDIO_SESSION_COOKIE } from './handlers/studio.js'
export { studioOnboardingRoutes } from './handlers/studio-onboarding.js'
export { studioProfessionalRoutes } from './handlers/studio-professional.js'
export { studioInvitationRoutes } from './handlers/studio-invitations.js'
export { studioOwnershipInvitationRoutes } from './handlers/studio-ownership-invitations.js'
export { spaceIdentityRoutes } from './handlers/space.js'
export { spaceOnboardingRoutes } from './handlers/space-onboarding.js'
export { spaceBodyProgressRoutes } from './handlers/space-body-progress.js'
export { spaceHealthContextRoutes } from './handlers/space-health-context.js'
export { workosWebhookRoutes } from './handlers/webhooks.js'
export { backofficeIdentityRoutes, BACKOFFICE_SESSION_COOKIE } from './handlers/backoffice.js'
export { backofficeCredentialVerificationRoutes } from './handlers/backoffice-credential-verification.js'
export { backofficeTeamInvitationRoutes } from './handlers/backoffice-team-invitations.js'
export { backofficeAccountRecoveryRoutes } from './handlers/backoffice-account-recovery.js'
export { studioSessionService, trustedStudioWebUrl } from './dependencies.js'
export { backofficeAuthenticationService, trustedBackofficeWebUrl } from './dependencies.js'
export { StudioSessionError } from './application/index.js'
export type { StudioSessionService } from './application/index.js'
export { BackofficeAuthenticationError } from './application/backoffice.js'
export type { BackofficeAuthenticationService } from './application/backoffice.js'
export { StudioInvitationError } from './application/invitations.js'
export type { StudioInvitationService } from './application/invitations.js'
export type { IdentityWebhookService, IdentityWebhookOutcome } from './application/webhooks.js'
export type { AccountActor, BackofficeActor } from './domain/index.js'
export { spaceActorResolver, setSpaceActorResolver } from './dependencies.js'
export { SpaceActorError, createSpaceActorResolver } from './application/space-actor.js'
export type { SpaceActorResolver } from './application/space-actor.js'
