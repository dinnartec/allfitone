import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { SpaceExecutionService } from '../application/index.js'
import type {
  Execution,
  ExecutionSummary,
  FinishedExecution,
  HistoryMonth,
  HistoryPage,
  PeriodComparison,
} from '../domain/index.js'
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

const freeSession = {
  id: COMMAND_ID,
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
  window: { visible_from: null, has_hidden: false },
  page: { next_cursor: null, has_more: false },
}

const historyMonth: HistoryMonth = {
  month: '2026-09-01',
  visible_from: null,
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

const finished: FinishedExecution = {
  executed_session_id: EXECUTION_ID,
  revision_number: 4,
  started_at: '2026-09-29T23:02:00.000Z',
  ended_at: '2026-09-29T23:50:00.000Z',
  duration_seconds: 2880,
  title: 'Tirón',
  planned_session_id: PLANNED_ID,
  repeatable: true,
  session_number: 14,
  work_sets: 12,
  total_volume_kg: 3840,
  record_count: 2,
  previous: {
    executed_session_id: '019e4000-0000-7000-8000-000000000202',
    started_at: '2026-09-17T23:00:00.000Z',
    total_volume_kg: 3690,
    change_percent: 4,
  },
  exercises: [
    {
      position: 1,
      movement_id: '019e4000-0000-7000-8000-000000000501',
      movement: 'Remo con barra',
      superset_group: null,
      record: true,
      best_set: { load_kg: 70, reps: 8 },
      sets: [
        {
          set_order: 1,
          kind: 'normal',
          load_value: 70,
          load_unit_code: 'kg',
          achieved_reps: 8,
          rpe: null,
          best_ever: true,
        },
      ],
    },
  ],
}

function harness(overrides?: Partial<SpaceExecutionService>, actorFails = false): Hono {
  const service: SpaceExecutionService = {
    startAttempt: async () => attempt,
    startFreeSession: async () => freeSession,
    readOpenFreeSession: async () => null,
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
    comparePeriods: async () => comparison,
    readFinished: async () => finished,
    revise: async () => ({ id: EXECUTION_ID, revision_number: 5, result_count: 12 }),
    annul: async () => ({ id: EXECUTION_ID, annulled_at: '2026-10-01T12:00:00.000Z' }),
    readAnnulmentPreview: async () => ({ records: 2, streak_weeks: 8, streak_weeks_after: 7 }),
    repeat: async () => ({
      id: COMMAND_ID,
      attempt_number: 2,
      status: 'in_progress' as const,
      revision_number: 0,
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

const comparison: PeriodComparison = {
  period: 'week',
  periods: [
    {
      starts_on: '2026-10-12',
      sessions: 2,
      active_days: 2,
      trained_seconds: 5400,
      work_sets: 24,
      volume_kg: 8200,
      planned: 3,
      fulfilled: 2,
      muscles: [{ code: 'chest', name: 'Pecho', sets: 12 }],
    },
    {
      starts_on: '2026-10-19',
      sessions: 3,
      active_days: 3,
      trained_seconds: 7800,
      work_sets: 33,
      volume_kg: 9650,
      planned: 3,
      fulfilled: 3,
      muscles: [{ code: 'chest', name: 'Pecho', sets: 15 }],
    },
  ],
  movements: [
    {
      movement_id: '019ef600-0000-7000-8000-0000000000a1',
      name: 'Press',
      best_kg: 82.5,
      previous_best_kg: 80,
      change_kg: 2.5,
      bests: [80, 82.5],
    },
  ],
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
      'OP-EXE-004',
      'OP-EXE-005',
      'OP-EXE-006',
      'OP-EXE-007',
      'OP-EXE-009',
      'OP-EXE-014',
      'OP-EXE-015',
      'OP-EXE-021',
      'OP-EXE-023',
      'OP-EXE-024',
      'OP-EXE-025',
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

describe('POST /space/v1/executions', () => {
  const free = { ...start, discipline_code: 'strength' }
  const begin = (
    body: unknown,
    headers: Record<string, string> = commanded,
    overrides?: Partial<SpaceExecutionService>,
  ) =>
    harness(overrides).request('/space/v1/executions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  test('T-EXE-API-17 starts a free session under the id the device chose', async () => {
    let received: Parameters<SpaceExecutionService['startFreeSession']>[0] | undefined
    const response = await begin(free, commanded, {
      startFreeSession: async (input) => {
        received = input
        return freeSession
      },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(freeSession)
    expect(response.headers.get('location')).toBe(`/space/v1/executions/${COMMAND_ID}`)
    expect(received?.commandId).toBe(COMMAND_ID)
    expect(received?.disciplineCode).toBe('strength')
    expect(received?.personId).toBe(PERSON_ID)
  })

  test('T-EXE-API-18 refuses a body without the discipline, or with a malformed one', async () => {
    expect((await begin(start)).status).toBe(400)
    expect((await begin({ ...free, discipline_code: 'Fuerza!' })).status).toBe(400)
  })

  test('T-EXE-API-19 refuses without command headers', async () => {
    const response = await begin(free, { ...authorized, 'content-type': 'application/json' })
    expect(response.status).toBe(400)
  })

  test('T-EXE-API-20 a second free session while one is open is a conflict', async () => {
    const response = await begin(free, commanded, {
      startFreeSession: async () => {
        throw Object.assign(new Error('a free session is already open'), { code: '55006' })
      },
    })
    expect(response.status).toBe(409)
  })

  test('T-EXE-API-21 requires a bearer token', async () => {
    const response = await harness().request('/space/v1/executions', {
      method: 'POST',
      body: JSON.stringify(free),
    })
    expect(response.status).toBe(401)
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

describe('a finished session: its detail, corrections, annulment and repeat', () => {
  const path = (tail: string) => `/space/v1/executions/${EXECUTION_ID}/${tail}`
  const post = (
    tail: string,
    body: unknown,
    headers: Record<string, string>,
    overrides?: Partial<SpaceExecutionService>,
  ) =>
    harness(overrides).request(path(tail), { method: 'POST', headers, body: JSON.stringify(body) })
  const revision = {
    started_at: '2026-09-29T23:02:00.000Z',
    ended_at: '2026-09-29T23:50:00.000Z',
    strength_sets: [{ order: 1, exercise_position: 1 }],
    exercises: [{ position: 1, movement_id: null, superset_group: null }],
  }

  test('T-EXE-API-FIN-01 answers the detail in the zone it was asked in', async () => {
    let zone: string | undefined
    const response = await harness({
      readFinished: async (input) => {
        zone = input.timezone
        return finished
      },
    }).request(path('detail?timezone=America/Bogota'), { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(finished)
    expect(zone).toBe('America/Bogota')
  })

  test('T-EXE-API-FIN-02 an annulled, unfinished or foreign session is not found', async () => {
    const response = await harness({ readFinished: async () => null }).request(
      path('detail?timezone=America/Bogota'),
      { headers: authorized },
    )

    expect(response.status).toBe(404)
    expect((await harness().request(path('detail'), { headers: authorized })).status).toBe(400)
  })

  test('T-EXE-API-FIN-03 a correction passes the session whole, under its revision', async () => {
    let asked: Parameters<SpaceExecutionService['revise']>[0] | undefined
    const response = await post(
      'revisions',
      revision,
      { ...commanded, 'if-match': '4' },
      {
        revise: async (input) => {
          asked = input
          return { id: EXECUTION_ID, revision_number: 5, result_count: 1 }
        },
      },
    )

    expect(response.status).toBe(200)
    expect(asked).toMatchObject({
      personId: PERSON_ID,
      executedSessionId: EXECUTION_ID,
      revisionNumber: 4,
      revision,
    })
  })

  test('T-EXE-API-FIN-04 refuses a correction it cannot honour', async () => {
    const headers = { ...commanded, 'if-match': '4' }
    expect((await post('revisions', revision, commanded)).status).toBe(400)
    expect((await post('revisions', { ...revision, ended_at: 'later' }, headers)).status).toBe(400)
    expect((await post('revisions', { ...revision, strength_sets: [] }, headers)).status).toBe(400)
    expect((await post('revisions', { ...revision, extra: true }, headers)).status).toBe(400)
  })

  test('T-EXE-API-FIN-05 a stale correction is a conflict', async () => {
    const response = await post(
      'revisions',
      revision,
      { ...commanded, 'if-match': '3' },
      {
        revise: async () => {
          throw Object.assign(new Error('stale-execution'), { code: '40001' })
        },
      },
    )

    expect(response.status).toBe(409)
  })

  test('T-EXE-API-FIN-06 annuls with the reason, or with none', async () => {
    const reasons: (string | null)[] = []
    const annul: Partial<SpaceExecutionService> = {
      annul: async (input) => {
        reasons.push(input.reason)
        return { id: EXECUTION_ID, annulled_at: '2026-10-01T12:00:00.000Z' }
      },
    }

    expect((await post('invalidation', {}, commanded, annul)).status).toBe(200)
    expect(
      (await post('invalidation', { reason: ' Fue una prueba ' }, commanded, annul)).status,
    ).toBe(200)
    expect(reasons).toEqual([null, 'Fue una prueba'])
    expect((await post('invalidation', { reason: 7 }, commanded)).status).toBe(400)
    expect((await post('invalidation', {}, authorized)).status).toBe(400)
  })

  test('T-EXE-API-FIN-07 answers what annulling would change', async () => {
    const response = await harness().request(path('invalidation-preview?timezone=America/Bogota'), {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ records: 2, streak_weeks: 8, streak_weeks_after: 7 })
  })

  test('T-EXE-API-FIN-08 a repeat starts another attempt, its id the Command-Id', async () => {
    const response = await post(
      'repetitions',
      { started_at: '2026-10-01T12:00:00.000Z', timezone: 'America/Bogota' },
      commanded,
    )

    expect(response.status).toBe(201)
    expect(((await response.json()) as { id: string }).id).toBe(COMMAND_ID)
  })

  test('T-EXE-API-FIN-09 another session still open is a conflict', async () => {
    const response = await post(
      'repetitions',
      { started_at: '2026-10-01T12:00:00.000Z', timezone: 'America/Bogota' },
      commanded,
      {
        repeat: async () => {
          throw Object.assign(new Error('another session is still open'), { code: '55006' })
        },
      },
    )

    expect(response.status).toBe(409)
  })
})

describe('GET /space/v1/progress/periods', () => {
  test('T-EXE-API-30 answers the periods with the person and the zone', async () => {
    let asked: unknown
    const watching = harness({
      comparePeriods: async (input) => {
        asked = { timezone: input.timezone, period: input.period, count: input.count }
        return comparison
      },
    })
    const response = await watching.request(
      '/space/v1/progress/periods?timezone=America/Bogota&period=week&count=8',
      { headers: authorized },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(comparison)
    expect(asked).toEqual({ timezone: 'America/Bogota', period: 'week', count: 8 })
  })

  test('T-EXE-API-31 a plan without the comparison says which function it lacks', async () => {
    const refused = harness({
      comparePeriods: async () => {
        throw Object.assign(new Error('this function comes with Pro'), {
          code: 'AF402',
          detail: 'period_analysis',
        })
      },
    })
    const response = await refused.request(
      '/space/v1/progress/periods?timezone=America/Bogota&period=month&count=6',
      { headers: authorized },
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ feature: 'period_analysis' })
  })

  test('T-EXE-API-32 refuses a period, a count or a zone outside the contract', async () => {
    for (const query of [
      'timezone=America/Bogota&period=day&count=4',
      'timezone=America/Bogota&period=week&count=1',
      'timezone=America/Bogota&period=week&count=13',
      'timezone=America/Bogota&period=week&count=two',
      'period=week&count=4',
    ]) {
      const response = await harness().request(`/space/v1/progress/periods?${query}`, {
        headers: authorized,
      })
      expect(response.status).toBe(400)
    }
  })
})
