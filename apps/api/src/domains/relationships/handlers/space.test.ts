/**
 * `T-REL-API-01` — the list that makes every other operation about a gym reachable.
 *
 * The cursor is what carries the weight here. It is the only thing in this handler that
 * could silently serve page one forever, which on a list somebody pages through reads as
 * duplicated gyms rather than as a bug.
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { VerifiedToken } from '@allfitone/auth-provider'
import type { SpaceActorResolver } from '../../identity/index.js'
import type { MyRelationshipService } from '../application/index.js'
import type { MyRelationship } from '../domain/index.js'
import { spaceRelationshipRoutes } from './space.js'

const PERSON = '019c7000-0000-7000-8000-000000000002'
const RELATIONSHIP = '019c7000-0000-7000-8000-000000000201'
const AUTH = { authorization: 'Bearer token' }

const verifier = async (): Promise<VerifiedToken> =>
  ({ subject: 'auth0|carla', sessionId: 'session' }) as VerifiedToken

const actors: SpaceActorResolver = {
  actorFor: async () => ({ accountId: 'account', personId: PERSON }),
  personFor: async () => PERSON,
}

function relationship(overrides: Partial<MyRelationship> = {}): MyRelationship {
  return {
    relationship_id: RELATIONSHIP,
    organization_id: '019c7000-0000-7000-8000-000000000101',
    organization_name: 'Gimnasio Uno',
    organization_type_code: 'gym',
    status: 'active',
    started_at: '2026-07-01T14:00:00.000Z',
    ended_at: null,
    previous_relationship_id: null,
    ...overrides,
  }
}

function service(
  page: { items: MyRelationship[]; hasMore: boolean } = { items: [relationship()], hasMore: false },
  capture?: Record<string, unknown>[],
): MyRelationshipService {
  return {
    listMine: async (_personId, query) => {
      capture?.push(query as unknown as Record<string, unknown>)
      return page
    },
  }
}

function app(relationships: MyRelationshipService): Hono {
  const routes = new Hono()
  routes.route('/space/v1', spaceRelationshipRoutes(relationships, verifier, actors))
  return routes
}

describe('the gyms I train at', () => {
  test('returns them with no fitness data of any kind', async () => {
    const response = await app(service()).request('/space/v1/relationships', { headers: AUTH })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      data: [relationship()],
      page: { has_more: false, next_cursor: null },
    })
  })

  test('includes a relationship that ended, with the link to what came before', async () => {
    const returned = relationship({
      status: 'terminated',
      ended_at: '2026-09-01T10:00:00.000Z',
      previous_relationship_id: '019c7000-0000-7000-8000-000000000200',
    })
    const response = await app(service({ items: [returned], hasMore: false })).request(
      '/space/v1/relationships',
      { headers: AUTH },
    )
    const body = (await response.json()) as { data: MyRelationship[] }
    expect(body.data[0]?.status).toBe('terminated')
    expect(body.data[0]?.previous_relationship_id).toBe('019c7000-0000-7000-8000-000000000200')
  })

  test('issues a cursor only when there is another page, and reads it back', async () => {
    const capture: Record<string, unknown>[] = []
    const paged = service({ items: [relationship()], hasMore: true }, capture)

    const first = await app(paged).request('/space/v1/relationships?limit=1', { headers: AUTH })
    const firstBody = (await first.json()) as { page: { next_cursor: string } }
    expect(firstBody.page.next_cursor).toBeString()

    await app(paged).request(`/space/v1/relationships?cursor=${firstBody.page.next_cursor}`, {
      headers: AUTH,
    })
    expect(capture.at(-1)).toMatchObject({
      cursorStartedAt: '2026-07-01T14:00:00.000Z',
      cursorRelationshipId: RELATIONSHIP,
    })
  })

  test('refuses a cursor it cannot read rather than serving page one again', async () => {
    const response = await app(service()).request(
      '/space/v1/relationships?cursor=bm90LWEtY3Vyc29yLWF0LWFsbA',
      { headers: AUTH },
    )
    expect(response.status).toBe(422)
  })

  test('refuses a limit past the maximum', async () => {
    const response = await app(service()).request('/space/v1/relationships?limit=101', {
      headers: AUTH,
    })
    expect(response.status).toBe(422)
  })

  test('a request with no bearer token is unauthenticated', async () => {
    const response = await app(service()).request('/space/v1/relationships')
    expect(response.status).toBe(401)
  })

  test('an empty list is a page, not a refusal', async () => {
    const response = await app(service({ items: [], hasMore: false })).request(
      '/space/v1/relationships',
      { headers: AUTH },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [],
      page: { has_more: false, next_cursor: null },
    })
  })
})
