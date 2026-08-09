/**
 * Public interface of the identity domain.
 *
 * Everything outside this module reaches identity through here and nowhere
 * else — the boundary rules enforce it. Reaching into `handlers/` or
 * `infrastructure/` from outside would couple callers to internals that are
 * meant to move freely.
 */

export { studioIdentityRoutes } from './handlers/studio.js'
export { spaceIdentityRoutes } from './handlers/space.js'
