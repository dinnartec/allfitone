export const POSTHOG_US_INGESTION_HOST = 'https://us.i.posthog.com'

/** Accepts only the canonical PostHog US ingestion origin. */
export function postHogUsHost(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.origin === POSTHOG_US_INGESTION_HOST &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? POSTHOG_US_INGESTION_HOST
      : undefined
  } catch {
    return undefined
  }
}
