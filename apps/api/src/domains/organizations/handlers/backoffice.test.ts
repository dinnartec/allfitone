import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { OrganizationDirectoryService } from '../application/directory.js'
import { backofficeOrganizationRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019ab000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019ab000-0000-7000-8000-000000000023'
const ORGANIZATION_ID = '019ab000-0000-7000-8000-000000000301'

const summary: AllfitV1Schemas['BackofficeOrganizationSummary'] = {
  organization_id: ORGANIZATION_ID,
  display_name: 'Dirtest Norte',
  type_code: 'gym',
  type_name: 'Gimnasio',
  status: 'active',
  created_at: '2026-08-04T15:00:00.000Z',
  claimed_at: '2026-08-04T15:00:00.000Z',
  cancelled_at: null,
  active_member_count: 1,
  site_count: 2,
  people_served: null,
}

let captured: unknown[] = []

function directoryService(
  overrides: Partial<OrganizationDirectoryService> = {},
): OrganizationDirectoryService {
  return {
    list: (_reader, input) => {
      captured.push(input)
      return Promise.resolve({
        items: [summary],
        hasMore: true,
        nextCursor: 'eyJuYW1lIjoiRGlydGVzdCJ9',
      })
    },
    ...overrides,
  }
}

function sessionService(
  overrides: Partial<BackofficeAuthenticationService> = {},
): BackofficeAuthenticationService {
  return {
    resolveActor: async () => ({ personId: ACTOR_PERSON_ID, sessionId: ACTOR_SESSION_ID }),
    ...overrides,
  } as BackofficeAuthenticationService
}

function routes(
  directory: OrganizationDirectoryService = directoryService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeOrganizationRoutes(directory, sessions))
}

function get(query = '', init: { cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: ORIGIN })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1/organizations${query}`, { headers })
}

function cursorFor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice organization directory API contract', () => {
  test('T-ORG-API-01 mounts every directory operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.allfitOperation === 'NEW-SUP-ORG-SEARCH')
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeOrganizationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(1)
    expect(mounted).toEqual(contract)
  })

  test('T-ORG-API-02 mounts the directory below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/organizations')
  })

  test('T-ORG-API-03 reads the directory as a page and keeps it out of any cache', async () => {
    const response = await routes().fetch(get())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [summary],
      page: { has_more: true, next_cursor: 'eyJuYW1lIjoiRGlydGVzdCJ9' },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('T-ORG-API-04 passes the search, the state, the page size and the cursor through', async () => {
    const cursor = cursorFor({ name: 'Dirtest Norte', id: ORGANIZATION_ID })
    const response = await routes().fetch(
      get(`?q=%20norte%20&status=unclaimed&limit=10&cursor=${cursor}`),
    )

    expect(response.status).toBe(200)
    expect(captured[0]).toMatchObject({
      query: 'norte',
      status: 'unclaimed',
      limit: 10,
      cursor: { name: 'Dirtest Norte', id: ORGANIZATION_ID },
    })
  })

  test('T-ORG-API-05 refuses a filter it cannot read instead of widening the question', async () => {
    const answers = await Promise.all(
      [
        '?q=d',
        `?q=${'x'.repeat(121)}`,
        '?status=suspended_forever',
        '?owner=someone',
        '?limit=0',
        '?limit=101',
        '?cursor=not-a-cursor-at-all',
        `?cursor=${cursorFor({ name: 'Dirtest', id: 'not-a-uuid' })}`,
      ].map((query) => routes().fetch(get(query))),
    )

    expect(answers.map((response) => response.status)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400,
    ])
    expect(captured).toEqual([])
  })

  test('T-ORG-API-06 turns a missing duty into forbidden', async () => {
    const response = await routes(
      directoryService({
        list: () => Promise.reject(Object.assign(new Error('denied'), { code: '42501' })),
      }),
    ).fetch(get())

    expect(response.status).toBe(403)
  })

  test('T-ORG-API-07 answers unauthenticated without a session and when it ended', async () => {
    const missing = await routes().fetch(get('', { cookie: false }))
    const ended = await routes(
      directoryService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(get())

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
