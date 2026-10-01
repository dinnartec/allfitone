import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { SpaceExecutionService } from '../application/index.js'
import type { Execution, ExecutionSummary, HistoryMonth, HistoryPage } from '../domain/index.js'
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
  exercises: [],
}

const summary: ExecutionSummary = {
  executed_session_id: EXECUTION_ID,
  started_at: '2026-09-01T12:00:00.000Z',
  ended_at: '2026-09-01T12:48:12.000Z',
  duration_seconds: 2892,
  title: 'Tirón',
  work_sets: 12,
  exercise_count: 4,
  total_volume_kg: 3840,
  exercises: [],
  records: [],
  streak_weeks: 8,
  session_number: 14,
  given_name: 'Walberto',
  username: 'walberto',
  cover_url: null,
  algorithm_version: 1,
}

const historyPage: HistoryPage = {
  data: [
    {
      executed_session_id: EXECUTION_ID,
      status: 'completed',
      started_at: '2026-09-01T12:00:00.000Z',
      trained_on: '2026-09-01',
      title: 'Empuje',
      is_free: false,
      discipline_code: 'strength',
      duration_seconds: 3120,
      work_sets: 14,
      total_volume_kg: 4410,
      record_count: 1,
      thumbnail_url: 'https://media.example/movements/press/demo.webp',
    },
  ],
  page: { next_cursor: null, has_more: false },
}

const historyMonth: HistoryMonth = {
  month: '2026-09-01',
  sessions: 1,
  trained_seconds: 3120,
  work_sets: 14,
  total_volume_kg: 4410,
  records: 1,
  weeks: [{ week_starts_on: '2026-08-31', completed: 1, planned: 3, fulfilled: 1 }],
  days: [
    {
      trained_on: '2026-09-02',
      sessions: 1,
      trained_seconds: 3120,
      work_sets: 14,
      volume_kg: 4410,
      records: 1,
    },
  ],
  months_available: ['2026-09-01'],
  disciplines: [{ code: 'strength', name: 'Fuerza' }],
}

function harness(overrides?: Partial<SpaceExecutionService>, actorFails = false): Hono {
  const service: SpaceExecutionService = {
    startAttempt: async () => attempt,
    replaceResults: async () => state,
    finalize: async () => finalized,
    abandon: async () => abandonedState,
    readExecution: async () => execution,
    readSummary: async () => summary,
    readWeekSummary: async () => ({
      trained_seconds: 0,
      sessions_completed: 0,
      sessions_planned: 0,
      tonnage_kg: 5120.5,
      history: [],
      work_sets: 0,
    }),
    listHistory: async () => historyPage,
    readHistoryMonth: async () => historyMonth,
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
      'OP-EXE-014',
      'OP-EXE-015',
      'OP-EXE-021',
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

  test('T-EXE-API-EXER-03 takes the exercise list with the sets', async () => {
    const withList = {
      ...results,
      exercises: [{ position: 1, movement_id: null, superset_group: null }],
    }

    expect((await put(withList, { ...commanded, 'if-match': '2' })).status).toBe(200)
  })

  test('T-EXE-API-EXER-05 takes each exercise with its rest', async () => {
    const withRest = {
      ...results,
      exercises: [{ position: 1, movement_id: null, superset_group: null, rest_seconds: 90 }],
    }

    expect((await put(withRest, { ...commanded, 'if-match': '2' })).status).toBe(200)
  })

  test('T-EXE-API-EXER-04 refuses an exercise list that is not a list', async () => {
    const response = await put({ ...results, exercises: 'none' }, { ...commanded, 'if-match': '2' })

    expect(response.status).toBe(400)
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

describe('GET /space/v1/executions/{id}/summary', () => {
  const read = (path: string, overrides?: Partial<SpaceExecutionService>) =>
    harness(overrides).request(path, { headers: authorized })

  test('T-EXE-API-SUM-04 answers the summary of a finished session', async () => {
    const response = await read(
      `/space/v1/executions/${EXECUTION_ID}/summary?timezone=America/Bogota`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(summary)
  })

  test('T-EXE-API-SUM-05 refuses without the zone that weeks are counted in', async () => {
    expect((await read(`/space/v1/executions/${EXECUTION_ID}/summary`)).status).toBe(400)
  })

  test("T-EXE-API-SUM-06 answers not-found for one that is not this person's", async () => {
    const response = await read(
      `/space/v1/executions/${EXECUTION_ID}/summary?timezone=America/Bogota`,
      { readSummary: async () => null },
    )

    expect(response.status).toBe(404)
  })

  test('T-EXE-API-SUM-07 answers conflict for a session still open', async () => {
    const response = await read(
      `/space/v1/executions/${EXECUTION_ID}/summary?timezone=America/Bogota`,
      {
        readSummary: async () => {
          throw Object.assign(new Error('execution is not finished'), { code: '55000' })
        },
      },
    )

    expect(response.status).toBe(409)
  })
})

describe('GET /space/v1/executions', () => {
  const read = (path: string, overrides?: Partial<SpaceExecutionService>) =>
    harness(overrides).request(path, { headers: authorized })

  test('T-EXE-API-HIST-01 answers one page of the history, filters passed through', async () => {
    let asked: Parameters<SpaceExecutionService['listHistory']>[0] | undefined
    const response = await read(
      '/space/v1/executions?timezone=America/Bogota&month=2026-09-15&discipline=strength&with_record=true&free=false&q=%20press%20&limit=10&day=2026-09-30',
      {
        listHistory: async (input) => {
          asked = input
          return historyPage
        },
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(historyPage)
    expect(asked).toEqual({
      personId: PERSON_ID,
      timezone: 'America/Bogota',
      month: '2026-09-15',
      discipline: 'strength',
      withRecord: true,
      free: false,
      query: 'press',
      cursor: null,
      limit: 10,
      day: '2026-09-30',
      requestId: '',
    })
  })

  test('T-EXE-API-HIST-02 with nothing but the zone, every filter is off and the page is 20', async () => {
    let asked: Parameters<SpaceExecutionService['listHistory']>[0] | undefined
    await read('/space/v1/executions?timezone=America/Bogota', {
      listHistory: async (input) => {
        asked = input
        return historyPage
      },
    })

    expect(asked).toMatchObject({
      month: null,
      discipline: null,
      withRecord: null,
      free: null,
      query: null,
      cursor: null,
      limit: 20,
      day: null,
    })
  })

  test('T-EXE-API-HIST-03 refuses a request it cannot answer truthfully', async () => {
    for (const path of [
      '/space/v1/executions',
      '/space/v1/executions?timezone=America/Bogota&month=2026-13-01',
      '/space/v1/executions?timezone=America/Bogota&day=30-09-2026',
      '/space/v1/executions?timezone=America/Bogota&with_record=maybe',
      '/space/v1/executions?timezone=America/Bogota&limit=51',
      '/space/v1/executions?timezone=America/Bogota&cursor=short',
    ]) {
      expect((await read(path)).status).toBe(400)
    }
  })

  test('T-EXE-API-HIST-04 a cursor PostgreSQL cannot read is a bad request, not a page', async () => {
    const response = await read(
      '/space/v1/executions?timezone=America/Bogota&cursor=bm90LWEtcmVhbC1jdXJzb3I=',
      {
        listHistory: async () => {
          throw Object.assign(new Error('invalid cursor'), { code: '22023' })
        },
      },
    )

    expect(response.status).toBe(400)
  })

  test('T-EXE-API-HIST-05 somebody not registered gets nothing', async () => {
    const response = await harness(undefined, true).request(
      '/space/v1/executions?timezone=America/Bogota',
      { headers: authorized },
    )

    expect(response.status).toBe(403)
  })
})

describe('GET /space/v1/history/months/{month}', () => {
  const read = (path: string, overrides?: Partial<SpaceExecutionService>) =>
    harness(overrides).request(path, { headers: authorized })

  test('T-EXE-API-HIST-06 answers the month', async () => {
    let asked: Parameters<SpaceExecutionService['readHistoryMonth']>[0] | undefined
    const response = await read('/space/v1/history/months/2026-09-01?timezone=America/Bogota', {
      readHistoryMonth: async (input) => {
        asked = input
        return historyMonth
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(historyMonth)
    expect(asked).toEqual({
      personId: PERSON_ID,
      timezone: 'America/Bogota',
      month: '2026-09-01',
      requestId: '',
    })
  })

  test('T-EXE-API-HIST-07 refuses a month that is not a date, or no zone', async () => {
    expect((await read('/space/v1/history/months/septiembre?timezone=America/Bogota')).status).toBe(
      400,
    )
    expect((await read('/space/v1/history/months/2026-09-01')).status).toBe(400)
  })
})
