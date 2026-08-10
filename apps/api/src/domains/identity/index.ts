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
export { spaceIdentityRoutes } from './handlers/space.js'
export { studioSessionService, trustedStudioWebUrl } from './dependencies.js'
export { StudioSessionError } from './application/index.js'
export type { StudioSessionService } from './application/index.js'
export type { StudioActor } from './domain/index.js'
