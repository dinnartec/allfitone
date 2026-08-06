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
