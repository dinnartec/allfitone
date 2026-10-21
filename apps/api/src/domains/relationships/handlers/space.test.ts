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
import type {
  MyRelationshipCommandService,
  MyRelationshipService,
  SubstitutionListService,
  SubstitutionTerminationService,
} from '../application/index.js'
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
    holder_name: 'Laura Gómez',
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

const SUBSTITUTION = '019c7000-0000-7000-8000-000000000401'
const END_PATH = `/space/v1/relationships/${RELATIONSHIP}/substitutions/${SUBSTITUTION}/termination`
const END_HEADERS = {
  ...AUTH,
  'idempotency-key': 'd4444444-4444-4444-8444-444444444444',
  'command-id': '019c7000-0000-7000-8000-000000000071',
}

function terminations(
  overrides: Partial<SubstitutionTerminationService> = {},
  capture?: (personId: string, input: Record<string, unknown>) => void,
): SubstitutionTerminationService {
  return {
    end: async () => {
      throw new Error('the Studio door is not this one')
    },
    endMine: async (personId, input) => {
      capture?.(personId, input as unknown as Record<string, unknown>)
      return {
        resource: {
          assignmentId: SUBSTITUTION,
          relationshipId: RELATIONSHIP,
          membershipId: '019c7000-0000-7000-8000-000000000301',
          professionalPersonId: '019c7000-0000-7000-8000-000000000011',
          endedAt: '2026-11-04T15:20:00.000Z',
        },
        replayed: false,
      }
    },
    ...overrides,
  }
}

function endApp(service: SubstitutionTerminationService = terminations()): Hono {
  const routes = new Hono()
  routes.route('/space/v1', spaceRelationshipRoutes(undefined, verifier, actors, service))
  return routes
}

function endCover(headers: Record<string, string> = END_HEADERS): Request {
  return new Request(`https://api.example.test${END_PATH}`, { method: 'POST', headers })
}

describe('stopping somebody covering for your coach', () => {
  test('answers with the instant the access stopped', async () => {
    const response = await endApp().fetch(endCover())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.ended_at).toBe('2026-11-04T15:20:00.000Z')
  })

  /*
   * The person comes from the token and nothing else. A relationship id in the
   * path that is not hers is the command's refusal to make, not this handler's
   * to guess — but the person it acts for must be the one who presented the
   * token, never a value the caller supplied.
   */
  test('acts for the person the token names', async () => {
    const seen: { personId?: string } = {}
    const app = endApp(terminations({}, (personId) => (seen.personId = personId)))
    await app.fetch(endCover())
    expect(seen.personId).toBe(PERSON)
  })

  test('without a token it is nobody', async () => {
    const { authorization: _auth, ...headers } = END_HEADERS
    const response = await endApp().fetch(endCover(headers))
    expect(response.status).toBe(401)
  })

  test('without command headers it is not a command', async () => {
    const { 'command-id': _id, ...headers } = END_HEADERS
    const response = await endApp().fetch(endCover(headers))
    expect(response.status).toBe(400)
  })

  test('a cover that is not running is a conflict', async () => {
    const refused = terminations({
      endMine: async () => {
        throw Object.assign(new Error('not running'), { code: 'P0004' })
      },
    })
    const response = await endApp(refused).fetch(endCover())
    expect(response.status).toBe(409)
  })

  test('is never stored by a cache', async () => {
    const response = await endApp().fetch(endCover())
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

const LIST_PATH = `/space/v1/relationships/${RELATIONSHIP}/substitutions`

function listedCover(overrides: Record<string, unknown> = {}) {
  return {
    assignmentId: '019c7000-0000-7000-8000-000000000401',
    membershipId: '019c7000-0000-7000-8000-000000000301',
    professionalPersonId: '019c7000-0000-7000-8000-000000000011',
    displayName: 'Daniela Hoyos',
    status: 'proposed' as const,
    validFrom: new Date('2026-11-02T00:00:00.000Z'),
    validTo: null,
    endsOn: '2026-11-09',
    acceptedByPersonAt: null,
    ...overrides,
  }
}

function substitutionPages(
  page: { items: ReturnType<typeof listedCover>[]; hasMore: boolean } = {
    items: [listedCover()],
    hasMore: false,
  },
  capture?: (personId: string, query: Record<string, unknown>) => void,
): SubstitutionListService {
  return {
    list: async () => {
      throw new Error('the Studio door is not this one')
    },
    listMine: async (personId, query) => {
      capture?.(personId, query as unknown as Record<string, unknown>)
      return page
    },
  }
}

function listApp(service: SubstitutionListService = substitutionPages()): Hono {
  const routes = new Hono()
  routes.route(
    '/space/v1',
    spaceRelationshipRoutes(undefined, verifier, actors, undefined, service),
  )
  return routes
}

function askList(query = '', headers: Record<string, string> = AUTH): Request {
  return new Request(`https://api.example.test${LIST_PATH}${query}`, { headers })
}

describe('who has been authorised over my data', () => {
  test('answers the covers of her own relationship', async () => {
    const response = await listApp().fetch(askList())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { data: Record<string, unknown>[] }
    expect(payload.data[0]?.display_name).toBe('Daniela Hoyos')
  })

  /*
   * A cover still waiting on her answer is included on purpose: being asked is
   * itself something she is entitled to see, and it grants nothing until she
   * says yes.
   */
  test('includes one still waiting on her answer', async () => {
    const response = await listApp().fetch(askList())
    const payload = (await response.json()) as { data: Record<string, unknown>[] }
    expect(payload.data[0]?.status).toBe('proposed')
    expect(payload.data[0]?.accepted_by_person_at).toBeNull()
  })

  // The person comes from the token and nowhere else, and no organization is
  // named: she reaches a relationship of hers directly.
  test('asks for the person the token names, with no organization', async () => {
    const seen: { personId?: string; query?: Record<string, unknown> } = {}
    const app = listApp(
      substitutionPages(undefined, (personId, query) => {
        seen.personId = personId
        seen.query = query
      }),
    )
    await app.fetch(askList())
    expect(seen.personId).toBe(PERSON)
    expect(seen.query?.organizationId).toBeUndefined()
  })

  test('without a token it is nobody', async () => {
    const response = await listApp().fetch(askList('', {}))
    expect(response.status).toBe(401)
  })

  test('a cursor nobody could have issued is refused', async () => {
    const response = await listApp().fetch(askList('?cursor=not-a-cursor'))
    expect(response.status).toBe(422)
  })

  test('is never stored by a cache', async () => {
    const response = await listApp().fetch(askList())
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

const COMMAND_HEADERS = {
  ...AUTH,
  'content-type': 'application/json',
  'idempotency-key': '51111111-1111-4111-8111-111111111111',
  'command-id': '019c7000-0000-7000-8000-000000000901',
}
const COVER = '019c7000-0000-7000-8000-000000000401'

function mine(overrides: Partial<MyRelationshipCommandService> = {}): MyRelationshipCommandService {
  return {
    readHistory: async () => ({
      relationshipId: RELATIONSHIP,
      personId: PERSON,
      events: [],
      nextCursor: null,
      hasMore: false,
    }),
    decideSubstitution: async () => ({
      resource: {
        assignmentId: COVER,
        status: 'active',
        acceptedByPersonAt: '2026-11-04T15:20:00.000Z',
      },
      replayed: false,
    }),
    endRelationship: async () => ({
      resource: {
        relationshipId: RELATIONSHIP,
        endedAt: '2026-11-04T15:20:00.000Z',
        frozenGrants: 2,
        closedAssignments: 1,
      },
      replayed: false,
    }),
    ...overrides,
  }
}

function mineApp(commands: MyRelationshipCommandService = mine()): Hono {
  const routes = new Hono()
  routes.route(
    '/space/v1',
    spaceRelationshipRoutes(service(), verifier, actors, undefined, undefined, commands),
  )
  return routes
}

describe('her gyms name her coach', () => {
  test('T-REL-API-SPACE-01 each relationship says who is in charge of her', async () => {
    const response = await app(service()).request('/space/v1/relationships', { headers: AUTH })
    const body = (await response.json()) as { data: MyRelationship[] }
    expect(body.data[0]?.holder_name).toBe('Laura Gómez')
  })
})

describe('the history of her relationship', () => {
  test('T-REL-API-SPACE-02 reads it as herself, with no organization', async () => {
    const seen: Record<string, unknown> = {}
    const response = await mineApp(
      mine({
        readHistory: async (personId, query) => {
          Object.assign(seen, { personId, ...query })
          return {
            relationshipId: RELATIONSHIP,
            personId,
            events: [],
            nextCursor: null,
            hasMore: false,
          }
        },
      }),
    ).request(`/space/v1/relationships/${RELATIONSHIP}/events`, { headers: AUTH })
    expect(response.status).toBe(200)
    expect(seen.personId).toBe(PERSON)
    expect(seen.relationshipId).toBe(RELATIONSHIP)
  })

  test('T-REL-API-SPACE-03 one that is not hers is not found', async () => {
    const response = await mineApp(
      mine({
        readHistory: async () => {
          throw Object.assign(new Error('nope'), { code: 'P0002' })
        },
      }),
    ).request(`/space/v1/relationships/${RELATIONSHIP}/events`, { headers: AUTH })
    expect(response.status).toBe(404)
  })
})

describe('answering a cover', () => {
  const decide = (body: unknown, headers: Record<string, string> = COMMAND_HEADERS) =>
    mineApp().request(`/space/v1/relationships/${RELATIONSHIP}/substitutions/${COVER}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  test('T-REL-API-SPACE-04 her yes makes it run', async () => {
    const response = await decide({ decision: 'accepted' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { status: string }).status).toBe('active')
  })

  test('T-REL-API-SPACE-05 refuses anything but yes or no', async () => {
    expect((await decide({ decision: 'maybe' })).status).toBe(400)
  })

  test('T-REL-API-SPACE-06 without command headers it is not a command', async () => {
    expect(
      (await decide({ decision: 'accepted' }, { ...AUTH, 'content-type': 'application/json' }))
        .status,
    ).toBe(400)
  })

  test('T-REL-API-SPACE-07 a cover already decided is a conflict', async () => {
    const response = await mineApp(
      mine({
        decideSubstitution: async () => {
          throw Object.assign(new Error('decided'), { code: 'P0004' })
        },
      }),
    ).request(`/space/v1/relationships/${RELATIONSHIP}/substitutions/${COVER}/decision`, {
      method: 'POST',
      headers: COMMAND_HEADERS,
      body: JSON.stringify({ decision: 'rejected' }),
    })
    expect(response.status).toBe(409)
  })
})

describe('ending her relationship', () => {
  const end = (body: unknown, headers: Record<string, string> = COMMAND_HEADERS) =>
    mineApp().request(`/space/v1/relationships/${RELATIONSHIP}/termination`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  test('T-REL-API-SPACE-08 answers the instant and what was frozen', async () => {
    const response = await end({ reason: 'Me mudé' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      relationship_id: RELATIONSHIP,
      ended_at: '2026-11-04T15:20:00.000Z',
      frozen_grants: 2,
      closed_assignments: 1,
    })
  })

  test('T-REL-API-SPACE-09 a reason is optional, a blank one is refused', async () => {
    expect((await end({})).status).toBe(200)
    expect((await end({ reason: '' })).status).toBe(400)
  })
})
