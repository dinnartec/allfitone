import {
  createPostHogServerTelemetry,
  type ServerTelemetryAdapter,
} from '@allfitone/telemetry/posthog-node'
import {
  createPostHogOtlpLogs,
  type OperationalLogAdapter,
} from '@allfitone/telemetry/posthog-otlp-logs'
import { waitUntil } from '@vercel/functions'

let cached: ServerTelemetryAdapter | undefined
let cachedLogs: OperationalLogAdapter | undefined

export function serverTelemetry(): ServerTelemetryAdapter {
  if (cached) return cached

  const isVercel = process.env.VERCEL === '1'
  const apiKey = serverApiKey()
  const host = euPostHogHost(process.env.POSTHOG_HOST)
  cached = createPostHogServerTelemetry({
    ...(apiKey ? { apiKey } : {}),
    ...(host ? { host } : {}),
    immediate: isVercel,
    ...(isVercel ? { schedule: (work) => waitUntil(work) } : {}),
  })
  return cached
}

export async function shutdownServerTelemetry(): Promise<void> {
  await Promise.all([cached?.shutdown(), cachedLogs?.shutdown()])
}

export function serverOperationalLogs(): OperationalLogAdapter {
  if (cachedLogs) return cachedLogs
  const apiKey = serverApiKey()
  const host = euPostHogHost(process.env.POSTHOG_HOST)
  const isVercel = process.env.VERCEL === '1'
  cachedLogs = createPostHogOtlpLogs({
    ...(apiKey ? { apiKey } : {}),
    ...(host ? { host } : {}),
    immediate: isVercel,
    ...(isVercel ? { schedule: (work) => waitUntil(work) } : {}),
    serviceName: 'allfit-api',
  })
  return cachedLogs
}

/** Refuses accidental delivery to the unused US project. */
function euPostHogHost(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'eu.i.posthog.com'
      ? 'https://eu.i.posthog.com'
      : undefined
  } catch {
    return undefined
  }
}

function serverApiKey(): string | undefined {
  return process.env.ANALYTICS_SERVER_ENABLED === 'true'
    ? process.env.POSTHOG_SERVER_API_KEY
    : undefined
}
