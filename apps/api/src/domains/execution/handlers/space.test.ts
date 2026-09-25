import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { SpaceExecutionService } from '../application/index.js'
import type { Execution } from '../domain/index.js'
import { spaceExecutionRoutes } from './space.js'

const PERSON_ID = '019e4000-0000-7000-8000-000000000001'
const PLANNED_ID = '019e4000-0000-7000-8000-000000000101'
const EXECUTION_ID = '019e4000-0000-7000-8000-000000000201'
const IDEMPOTENCY_KEY = '51111111-1111-4111-8111-111111111111'
const COMMAND_ID = '019e4000-0000-7000-8000-000000000301'

const attempt = {
  id: EXECUTION_ID,
  attempt_number: 1,
  status: 'in_progress' as const,
  revision_number: 0,
  result_contract: {
    id: '019e4000-0000-7000-8000-000000000401',
    version: 1,
    requested_level: 'detailed' as const,
  },
}

const state = {
  id: EXECUTION_ID,
  status: 'in_progress' as const,
  revision_number: 3,
  segment_count: 0,
  result_count: 1,
}

const abandonedState = {
  id: EXECUTION_ID,
  status: 'abandoned' as const,
  revision_number: 2,
  result_count: 1,
}

const finalized = {
  id: EXECUTION_ID,
  status: 'completed' as const,
  validation_status: 'valid' as const,
  revision_number: 4,
  achieved_level: 'detailed' as const,
  is_primary: true,
  contract: { id: '019e4000-0000-7000-8000-000000000401', version: 1 },
}

const execution: Execution = {
  executed_session_id: EXECUTION_ID,
  execution_status: 'in_progress',
  started_at: '2026-09-01T12:00:00.000Z',
  revision_number: 2,
  title: 'Empuje',
  discipline_code: 'strength',
  program_title: 'Torso y pierna',
  week: 1,
  planned: [],
  results: [],
}

function harness(overrides?: Partial<SpaceExecutionService>, actorFails = false): Hono {
  const service: SpaceExecutionService = {
    startAttempt: async () => attempt,
    replaceResults: async () => state,
    finalize: async () => finalized,
    abandon: async () => abandonedState,
    readExecution: async () => execution,
    readWeekSummary: async () => ({
      trained_seconds: 0,
      sessions_completed: 0,
      sessions_planned: 0,
      tonnage_kg: 5120.5,
      history: [],
    }),
    ...overrides,
  }
  const actors: SpaceActorResolver = {
    actorFor: async () => ({ accountId: 'account', personId: PERSON_ID }),
    personFor: async () => {
      if (actorFails) throw new SpaceActorError('registration-incomplete')
      return PERSON_ID
    },
  }
  const app = new Hono()
  app.route(
    '/space/v1',
    spaceExecutionRoutes(
      service,
      async () => ({ subject: 'sub', sessionId: 'sid', surface: 'space' as const }),
      actors,
    ),
  )
  return app
}

const authorized = { authorization: 'Bearer token' }
const commanded = {
  ...authorized,
  'content-type': 'application/json',
  'idempotency-key': IDEMPOTENCY_KEY,
  'command-id': COMMAND_ID,
}
const start = {
  started_at: '2026-09-01T12:00:00.000Z',
  timezone: 'America/Bogota',
  requested_level: 'detailed',
  capture_source: 'manual',
}

describe('the Space execution surface honours the contract', () => {
  test('T-EXE-API-01 declares its four operations', () => {
    const declared = allfitV1ContractManifest.operations.filter(
      (operation) =>
        operation.path.startsWith('/space/v1/executions') ||
        operation.path.startsWith('/space/v1/planned-sessions'),
    )

    expect(declared.map((operation) => operation.allfitOperation).sort()).toEqual([
      'OP-EXE-001',
      'OP-EXE-003',
      'OP-EXE-005',
      'OP-EXE-006',
      'OP-EXE-015',
    ])
  })
})

describe('POST /space/v1/executions/{id}/abandonment', () => {
  test('T-EXE-API-14 answers what the abandoned attempt keeps', async () => {
    const response = await harness().request(`/space/v1/executions/${EXECUTION_ID}/abandonment`, {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ ended_at: '2026-09-01T13:00:00.000Z' }),
    })

    expect(response.status).toBe(200)
    // Leaving is not deleting: what was recorded stays in the history.
    expect(await response.json()).toEqual(abandonedState)
  })

  test('T-EXE-API-15 refuses without command headers', async () => {
    const response = await harness().request(`/space/v1/executions/${EXECUTION_ID}/abandonment`, {
      method: 'POST',
      headers: { ...authorized, 'content-type': 'application/json' },
      body: JSON.stringify({ ended_at: '2026-09-01T13:00:00.000Z' }),
    })

    expect(response.status).toBe(400)
  })

  test('T-EXE-API-16 refuses to abandon a session that is already finished', async () => {
    const finished = harness({
      abandon: async () => {
        throw Object.assign(new Error('execution is already finished'), { code: '23514' })
      },
    })
    const response = await finished.request(`/space/v1/executions/${EXECUTION_ID}/abandonment`, {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ ended_at: '2026-09-01T13:00:00.000Z' }),
    })

    expect(response.status).toBe(400)
  })
})

describe('POST /space/v1/planned-sessions/{id}/attempts', () => {
  const begin = (
    body: unknown,
    headers: Record<string, string> = commanded,
    session = PLANNED_ID,
  ) =>
    harness().request(`/space/v1/planned-sessions/${session}/attempts`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  test('T-EXE-API-02 answers the session the device named', async () => {
    const response = await begin(start)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(attempt)
    expect(response.headers.get('location')).toBe(`/space/v1/executions/${EXECUTION_ID}`)
  })

  test('T-EXE-API-03 refuses a completeness level outside the four', async () => {
    expect((await begin({ ...start, requested_level: 'exhaustive' })).status).toBe(400)
  })

  test('T-EXE-API-04 refuses a capture source it does not know', async () => {
    expect((await begin({ ...start, capture_source: 'telepathy' })).status).toBe(400)
  })

  test('T-EXE-API-05 refuses without command headers', async () => {
    const response = await begin(start, { ...authorized, 'content-type': 'application/json' })
    expect(response.status).toBe(400)
  })
})

describe('PUT /space/v1/executions/{id}/results', () => {
  const put = (body: unknown, headers: Record<string, string>) =>
    harness().request(`/space/v1/executions/${EXECUTION_ID}/results`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

  // No `segments`: the activity type was frozen when the attempt started, and a
  // client restating it could only contradict what is already recorded.
  const results = { strength_sets: [{ segment_position: 1, order: 1 }] }

  test('T-EXE-API-06 answers the revision the write produced', async () => {
    const response = await put(results, { ...commanded, 'if-match': '2' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(state)
  })

  test('T-EXE-API-07 refuses without the revision it claims to be editing', async () => {
    // Without it a second phone would overwrite the first and neither would know.
    expect((await put(results, commanded)).status).toBe(400)
  })

  test('T-EXE-API-08 answers conflict when the revision is stale', async () => {
    const stale = harness({
      replaceResults: async () => {
        throw Object.assign(new Error('stale-execution'), { code: '40001' })
      },
    })
    const response = await stale.request(`/space/v1/executions/${EXECUTION_ID}/results`, {
      method: 'PUT',
      headers: { ...commanded, 'if-match': '1' },
      body: JSON.stringify(results),
    })

    expect(response.status).toBe(409)
  })
})

describe('POST /space/v1/executions/{id}/finalize', () => {
  test('T-EXE-API-09 answers the finalised execution', async () => {
    const response = await harness().request(`/space/v1/executions/${EXECUTION_ID}/finalize`, {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ ended_at: '2026-09-01T13:00:00.000Z' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(finalized)
  })

  test('T-EXE-API-10 answers invalid-request when there is nothing to close', async () => {
    const empty = harness({
      finalize: async () => {
        throw Object.assign(new Error('execution has nothing recorded'), { code: '23514' })
      },
    })
    const response = await empty.request(`/space/v1/executions/${EXECUTION_ID}/finalize`, {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ ended_at: '2026-09-01T13:00:00.000Z' }),
    })

    expect(response.status).toBe(400)
  })
})

describe('GET /space/v1/executions/{id}', () => {
  test('T-EXE-API-11 answers the session and its revision', async () => {
    const response = await harness().request(`/space/v1/executions/${EXECUTION_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(execution)
  })

  test('T-EXE-API-12 answers not-found for one that belongs to somebody else', async () => {
    // Absent and forbidden are the same answer: otherwise the identifiers become
    // enumerable one request at a time.
    const response = await harness({ readExecution: async () => null }).request(
      `/space/v1/executions/${EXECUTION_ID}`,
      { headers: authorized },
    )

    expect(response.status).toBe(404)
  })

  test('T-EXE-API-13 refuses an account that has not activated its Fitness ID', async () => {
    const response = await harness(undefined, true).request(
      `/space/v1/executions/${EXECUTION_ID}`,
      { headers: authorized },
    )

    expect(response.status).toBe(403)
  })
})
