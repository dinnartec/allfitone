import { createHmac } from 'node:crypto'

import type { TelemetryEnvironment } from './index.js'

export interface AnalyticsIdentity {
  distinct_id: string | null
}

export interface AnalyticsPseudonymConfig {
  activeVersion: number
  encodedKey: string
}

export type AnalyticsClientSurface = 'backoffice' | 'space' | 'studio'

const CLIENT_GATE: Record<AnalyticsClientSurface, string> = {
  backoffice: 'ANALYTICS_BACKOFFICE_CLIENT_ENABLED',
  space: 'ANALYTICS_SPACE_CLIENT_ENABLED',
  studio: 'ANALYTICS_STUDIO_CLIENT_ENABLED',
}

export function deriveAnalyticsDistinctId(
  issuer: string,
  subject: string,
  config: AnalyticsPseudonymConfig,
): string {
  if (!issuer || !subject) throw new Error('Analytics pseudonym inputs must be non-empty')
  if (!Number.isSafeInteger(config.activeVersion) || config.activeVersion <= 0) {
    throw new Error('Analytics pseudonym version must be a positive integer')
  }
  const key = Buffer.from(config.encodedKey, 'base64')
  if (key.length !== 32) throw new Error('Analytics pseudonym keys must decode to 32 bytes')
  const digest = createHmac('sha256', key)
    .update(`allfitone.analytics.v1\u0000${issuer}\u0000${subject}`, 'utf8')
    .digest('base64url')
  return `a${config.activeVersion}_${digest}`
}

export function analyticsIdentityFromEnvironment(
  issuer: string,
  subject: string,
  environment: NodeJS.ProcessEnv = process.env,
): AnalyticsIdentity {
  const activeVersion = Number(environment.ANALYTICS_PSEUDONYM_ACTIVE_VERSION)
  if (!Number.isSafeInteger(activeVersion) || activeVersion <= 0) return { distinct_id: null }
  const encodedKey = environment[`ANALYTICS_PSEUDONYM_KEY_V${activeVersion}`]
  if (!encodedKey) return { distinct_id: null }
  try {
    return {
      distinct_id: deriveAnalyticsDistinctId(issuer, subject, { activeVersion, encodedKey }),
    }
  } catch {
    return { distinct_id: null }
  }
}

/** Returns no pseudonym while the corresponding client telemetry gate is off. */
export function analyticsIdentityForSurfaceFromEnvironment(
  surface: AnalyticsClientSurface,
  issuer: string,
  subject: string,
  environment: NodeJS.ProcessEnv = process.env,
): AnalyticsIdentity {
  if (
    telemetryEnvironmentFromRuntime(environment) !== 'production' ||
    environment[CLIENT_GATE[surface]] !== 'true'
  ) {
    return { distinct_id: null }
  }
  return analyticsIdentityFromEnvironment(issuer, subject, environment)
}

export function telemetryEnvironmentFromRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryEnvironment {
  const vercelEnvironment = environment.VERCEL_ENV
  if (
    vercelEnvironment === 'production' ||
    vercelEnvironment === 'preview' ||
    vercelEnvironment === 'development'
  ) {
    return vercelEnvironment
  }
  return environment.NODE_ENV === 'production' ? 'production' : 'development'
}
