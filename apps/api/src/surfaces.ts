/**
 * Mounts the REST surfaces.
 *
 * A surface is a view of the domain, not a domain. Each domain's handlers are
 * grouped by surface and mounted under its prefix; the logic lives in
 * `application/` and is never duplicated across surfaces.
 *
 * Each surface validates that the token's `client_id` belongs to it: a token
 * issued for Space does not operate on /backoffice/v1 even if the person exists.
 * That rejection is `wrong-surface` 403.
 */

import type { Hono } from 'hono'

import { studioIdentityRoutes } from './domains/identity/index.js'

export function mountSurfaces(app: Hono): void {
  app.route('/studio/v1', studioIdentityRoutes())

  // Mounted as each vertical slice lands:
  // app.route('/space/v1', spaceSurface())
  // app.route('/catalog/v1', catalogSurface())
  // app.route('/backoffice/v1', backofficeSurface())
}
