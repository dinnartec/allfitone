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

import {
  backofficeCatalogRoutes,
  backofficeGlobalCatalogueRoutes,
  catalogMovementRoutes,
  catalogSurfaceRoutes,
  studioCatalogRoutes,
} from './domains/catalog/index.js'
import { spaceExecutionRoutes } from './domains/execution/index.js'
import {
  backofficeAccountRecoveryRoutes,
  backofficeCredentialVerificationRoutes,
  backofficeIdentityRoutes,
  backofficeTeamInvitationRoutes,
  spaceBodyProgressRoutes,
  spaceHealthContextRoutes,
  spaceIdentityRoutes,
  spaceOnboardingRoutes,
  studioIdentityRoutes,
  studioInvitationRoutes,
  studioOnboardingRoutes,
  studioOwnershipInvitationRoutes,
  studioProfessionalRoutes,
  trustedBackofficeWebUrl,
  trustedStudioWebUrl,
} from './domains/identity/index.js'
import {
  backofficeOrganizationRoutes,
  studioOrganizationRoutes,
} from './domains/organizations/index.js'
import { spaceMealRoutes } from './domains/nutrition/index.js'
import { backofficePlatformPlanRoutes } from './domains/payments/index.js'
import { spacePlanningRoutes, studioPlanningRoutes } from './domains/planning/index.js'
import { backofficePrivacyRoutes } from './domains/privacy/index.js'
import {
  backofficeBreakGlassRoutes,
  backofficePlatformAccessRoutes,
  backofficeSupportMetadataRoutes,
} from './domains/support/index.js'
import { clientTelemetryConfigRoutes } from './platform/telemetry/client-config.js'

export function mountSurfaces(app: Hono): void {
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
  app.route('/studio/v1', studioOrganizationRoutes())
  app.route('/studio/v1', studioCatalogRoutes())
  app.route('/studio/v1', studioPlanningRoutes())
  app.route('/space/v1', spaceIdentityRoutes())
  app.route('/space/v1', spaceOnboardingRoutes())
  app.route('/space/v1', spaceBodyProgressRoutes())
  app.route('/space/v1', spaceHealthContextRoutes())
  app.route('/space/v1', spaceMealRoutes())
  app.route('/space/v1', spacePlanningRoutes())
  app.route('/space/v1', spaceExecutionRoutes())
  app.route('/backoffice/v1', backofficeIdentityRoutes())
  app.route('/backoffice/v1', backofficeCredentialVerificationRoutes())
  app.route('/backoffice/v1', backofficeTeamInvitationRoutes())
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
