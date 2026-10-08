/**
 * PostgreSQL connection boundary.
 *
 * Supavisor runs in transaction mode in production, so prepared statements are
 * disabled and every authorization setting is transaction-local. The client is
 * module-scoped so warm serverless invocations reuse their small connection pool.
 */

import postgres from 'postgres'

let cached: ReturnType<typeof postgres> | undefined

export function database(): ReturnType<typeof postgres> {
  if (cached) return cached

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  cached = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return cached
}

/** Test seam. Undefined restores environment-backed construction. */
export async function setDatabase(client: ReturnType<typeof postgres> | undefined): Promise<void> {
  if (cached && cached !== client) await cached.end({ timeout: 1 })
  cached = client
}

/**
 * Whether PostgreSQL answers right now.
 *
 * The API cannot serve a single route without it, so a health endpoint that skips this
 * reports the process, not the service. The timeout is the point: a database that hangs
 * is unreachable for the caller deciding whether to send traffic here, and waiting on the
 * connection timeout would turn the probe itself into the outage.
 */
export async function databaseReachable(timeoutMs = 2000): Promise<boolean> {
  let expire: ReturnType<typeof setTimeout> | undefined
  try {
    const answered = database()`select 1 as reachable`
    const expired = new Promise<'expired'>((resolve) => {
      expire = setTimeout(() => resolve('expired'), timeoutMs)
    })
    return (await Promise.race([answered.then(() => 'answered' as const), expired])) === 'answered'
  } catch {
    // Unreachable covers every reason equally: no URL configured, refused, or broken.
    return false
  } finally {
    if (expire) clearTimeout(expire)
  }
}
