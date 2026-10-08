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

import { cors } from 'hono/cors'
import type { Hono } from 'hono'

import {
  backofficeCatalogRoutes,
  backofficeGlobalCatalogueRoutes,
  catalogMovementRoutes,
  catalogSurfaceRoutes,
  studioCatalogRoutes,
} from './domains/catalog/index.js'
import { spaceExecutionRoutes } from './domains/execution/index.js'
import { spaceNutritionRoutes } from './domains/nutrition/index.js'
import {
  backofficeAccountRecoveryRoutes,
  backofficeCredentialVerificationRoutes,
  backofficeIdentityRoutes,
  backofficeClientInvitationRoutes,
  backofficeTeamInvitationRoutes,
  spaceBodyProgressRoutes,
  spaceHealthContextRoutes,
  spaceIdentityRoutes,
  spaceOnboardingRoutes,
  studioIdentityRoutes,
  studioInvitationRoutes,
  studioOnboardingRoutes,
  studioOwnershipInvitationRoutes,
  studioClientInvitationRoutes,
  spaceClientInvitationRoutes,
  studioProfessionalRoutes,
  trustedBackofficeWebUrl,
  trustedStudioWebUrl,
} from './domains/identity/index.js'
import {
  backofficeOrganizationRoutes,
  studioOrganizationRoutes,
} from './domains/organizations/index.js'
import { backofficePlatformPlanRoutes } from './domains/payments/index.js'
import { spacePlanningRoutes, studioPlanningRoutes } from './domains/planning/index.js'
import { backofficePrivacyRoutes, studioPrivacyRoutes } from './domains/privacy/index.js'
import { studioRelationshipRoutes } from './domains/relationships/index.js'
import {
  backofficeBreakGlassRoutes,
  backofficePlatformAccessRoutes,
  backofficeSupportMetadataRoutes,
} from './domains/support/index.js'
import { clientTelemetryConfigRoutes } from './platform/telemetry/client-config.js'

export function mountSurfaces(app: Hono): void {
  /*
   * One CORS answer for the whole Studio surface, declared before anything is
   * mounted under it.
   *
   * Eleven sub-applications mount at `/studio/v1`, and each used to register its
   * own `cors()` on `*`. For a real request that is merely repetitive — they all
   * agree on origin and credentials. For a **preflight** it is not: Hono's cors
   * middleware answers an OPTIONS request and stops, so whichever ran first
   * decided the answer for every path on the surface, and the other ten were
   * configuration that looked live and was not.
   *
   * It broke retiring a site in production. `organizations/handlers/studio.ts`
   * carefully lists `PATCH` and `If-Match`; the browser never saw them, because
   * a handler that serves neither answered the preflight with
   * `GET, POST, PUT, OPTIONS`.
   *
   * So the methods and headers here are the union of what the surface serves.
   * Widening them is safe: a preflight tells the browser what it may send, not
   * what it may reach. A path that does not accept PATCH still refuses it.
   */
  app.use(
    '/studio/v1/*',
    cors({
      origin: new URL(trustedStudioWebUrl()).origin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-Match', 'If-None-Match'],
      exposeHeaders: ['ETag', 'Server-Timing', 'Retry-After', 'Idempotent-Replay'],
      maxAge: 600,
    }),
  )

  app.route(
    '/studio/v1',
    clientTelemetryConfigRoutes('studio', new URL(trustedStudioWebUrl()).origin),
  )
  app.route(
    '/backoffice/v1',
    clientTelemetryConfigRoutes('backoffice', new URL(trustedBackofficeWebUrl()).origin),
  )
  app.route('/space/v1', clientTelemetryConfigRoutes('space'))
  app.route('/studio/v1', studioIdentityRoutes())
  app.route('/studio/v1', studioOnboardingRoutes())
  app.route('/studio/v1', studioProfessionalRoutes())
  app.route('/studio/v1', studioInvitationRoutes())
  app.route('/studio/v1', studioOwnershipInvitationRoutes())
  app.route('/studio/v1', studioClientInvitationRoutes())
  app.route('/studio/v1', studioPrivacyRoutes())
  app.route('/studio/v1', studioOrganizationRoutes())
  app.route('/studio/v1', studioRelationshipRoutes())
  app.route('/studio/v1', studioCatalogRoutes())
  app.route('/studio/v1', studioPlanningRoutes())
  app.route('/space/v1', spaceIdentityRoutes())
  app.route('/space/v1', spaceOnboardingRoutes())
  app.route('/space/v1', spaceBodyProgressRoutes())
  app.route('/space/v1', spaceHealthContextRoutes())
  app.route('/space/v1', spaceClientInvitationRoutes())
  app.route('/space/v1', spacePlanningRoutes())
  app.route('/space/v1', spaceExecutionRoutes())
  app.route('/space/v1', spaceNutritionRoutes())
  app.route('/backoffice/v1', backofficeIdentityRoutes())
  app.route('/backoffice/v1', backofficeCredentialVerificationRoutes())
  app.route('/backoffice/v1', backofficeTeamInvitationRoutes())
  app.route('/backoffice/v1', backofficeClientInvitationRoutes())
  app.route('/backoffice/v1', backofficeAccountRecoveryRoutes())
  app.route('/backoffice/v1', backofficePlatformAccessRoutes())
  app.route('/backoffice/v1', backofficeSupportMetadataRoutes())
  app.route('/backoffice/v1', backofficeBreakGlassRoutes())
  app.route('/backoffice/v1', backofficePrivacyRoutes())
  app.route('/backoffice/v1', backofficeCatalogRoutes())
  app.route('/backoffice/v1', backofficeGlobalCatalogueRoutes())
  app.route('/backoffice/v1', backofficeOrganizationRoutes())
  app.route('/backoffice/v1', backofficePlatformPlanRoutes())

  // The global catalogue is one surface, not a copy per product: it has no
  // subject and no tenant, so every product reads the same mount.
  app.route('/catalog/v1', catalogSurfaceRoutes())
  app.route('/catalog/v1', catalogMovementRoutes())
}
