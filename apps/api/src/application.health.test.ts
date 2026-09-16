/**
 * Health is a readiness answer, not a greeting.
 *
 * The API answered `ok` for eight hours with its database stopped, which is the worst
 * kind of green: a platform that restarts on a failing probe never restarted, and a
 * person reading the endpoint concluded the wrong thing. The probe now reaches the one
 * dependency the API cannot work without.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type postgres from 'postgres'

import { createApp } from './application.js'
import { databaseReachable, setDatabase } from './platform/db/index.js'

function fakeDatabase(answer: () => Promise<unknown>): ReturnType<typeof postgres> {
  const client = Object.assign(() => answer(), {
    begin: (operation: (transaction: unknown) => Promise<unknown>) => operation(client),
    end: () => Promise.resolve(),
  })
  return client as unknown as ReturnType<typeof postgres>
}

beforeEach(() => {
  process.env.API_PUBLIC_URL = 'https://api.example.test'
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
})

afterEach(async () => {
  await setDatabase(undefined)
})

describe('health', () => {
  test('T-API-HEALTH-01 answers ok only when the database answers too', async () => {
    await setDatabase(fakeDatabase(() => Promise.resolve([{ reachable: 1 }])))

    const response = await createApp().request('/health')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'ok' },
    })
  })

  test('T-API-HEALTH-02 answers degraded with 503 when the database refuses', async () => {
    await setDatabase(fakeDatabase(() => Promise.reject(new Error('connection refused'))))

    const response = await createApp().request('/health')
    const body = (await response.json()) as { status: string; checks: { database: string } }

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'degraded', checks: { database: 'unreachable' } })
    // The reason never travels: a health endpoint is unauthenticated.
    expect(JSON.stringify(body)).not.toContain('connection refused')
  })

  test('T-API-HEALTH-03 gives up on a database that never answers', async () => {
    await setDatabase(fakeDatabase(() => new Promise(() => undefined)))

    await expect(databaseReachable(20)).resolves.toBeFalse()
  })

  test('T-API-HEALTH-04 answers degraded rather than throwing when there is no database at all', async () => {
    const configured = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const response = await createApp().request('/health')
      expect(response.status).toBe(503)
    } finally {
      if (configured !== undefined) process.env.DATABASE_URL = configured
    }
  })
})
