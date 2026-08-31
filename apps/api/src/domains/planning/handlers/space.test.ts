import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { ProgramCatalogue, SpacePlanningService } from '../application/space.js'
import type { ProgramAssignment, ProgramDetail } from '../domain/space.js'
import { spacePlanningRoutes } from './space.js'

const PERSON_ID = '019f9000-0000-7000-8000-000000000001'
const VERSION_ID = '019f3000-0000-7000-8000-000000000006'
const ASSIGNMENT_ID = '019f9000-0000-7000-8000-000000000011'
const IDEMPOTENCY_KEY = '31111111-1111-4111-8111-111111111111'
const COMMAND_ID = '019f9000-0000-7000-8000-000000000021'

const assignment: ProgramAssignment = {
  assignment_id: ASSIGNMENT_ID,
  program_version_id: VERSION_ID,
  title: 'Empuje · tirón · pierna',
  starts_on: '2026-08-31',
  timezone: 'America/Bogota',
  sessions_planned: 60,
}

const detail: ProgramDetail = {
  program_version_id: VERSION_ID,
  title: 'Empuje · tirón · pierna',
  notes: 'Un reparto clásico de empuje, tirón y pierna.',
  weeks: 12,
  days_per_week: 5,
  sex_affinity: null,
  goals: ['build_muscle'],
  levels: ['some_practice', 'experienced'],
  emphases: ['back', 'chest', 'legs'],
  days: [
    {
      day: 1,
      title: 'Empuje',
      discipline_code: 'strength',
      steps: [
        {
          position: 1,
          movement_id: null,
          movement: 'Press de banca con barra',
          target: { family: 'strength', target_sets: 4, target_reps: 8 },
        },
      ],
    },
  ],
}

const catalogue: ProgramCatalogue = {
  profile: {
    given_name: 'Walberto',
    primary_training_goal: 'build_muscle',
    training_experience: 'some_practice',
    biological_sex: 'male',
    focus_areas: ['chest', 'back'],
  },
  programs: [
    {
      program_version_id: VERSION_ID,
      program_id: '019f3000-0000-7000-8000-000000000006',
      title: 'Empuje · tirón · pierna',
      weeks: 12,
      days_per_week: 5,
      sex_affinity: null,
      goals: ['build_muscle'],
      levels: ['some_practice', 'experienced'],
      emphases: ['back', 'chest', 'legs'],
    },
  ],
  current_assignment: null,
}

function harness(overrides?: {
  service?: Partial<SpacePlanningService>
  actors?: Partial<SpaceActorResolver>
}): Hono {
  const service: SpacePlanningService = {
    readCatalogue: async () => catalogue,
    readTodaySession: async () => null,
    readProgram: async () => detail,
    chooseProgram: async () => assignment,
    ...overrides?.service,
  }
  const actors: SpaceActorResolver = {
    actorFor: async () => ({ accountId: 'account', personId: PERSON_ID }),
    personFor: async () => PERSON_ID,
    ...overrides?.actors,
  }
  const app = new Hono()
  app.route(
    '/space/v1',
    spacePlanningRoutes(
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

describe('the Space planning surface honours the contract', () => {
  test('T-PLN-API-050 both routes are declared with their operations', () => {
    const declared = allfitV1ContractManifest.operations.filter(
      (operation) =>
        operation.path.startsWith('/space/v1/programs') ||
        operation.path.startsWith('/space/v1/assignments'),
    )
    expect(declared).toHaveLength(3)
    expect(declared.map((operation) => operation.allfitOperation).sort()).toEqual([
      'OP-PLN-011',
      'OP-PLN-020',
      'OP-PLN-021',
    ])
  })
})

describe('GET /space/v1/programs', () => {
  test('T-PLN-API-051 answers the catalogue, the profile and the current program', async () => {
    const response = await harness().request('/space/v1/programs', { headers: authorized })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(catalogue)
  })

  test('T-PLN-API-052 refuses without a bearer token', async () => {
    const response = await harness().request('/space/v1/programs')
    expect(response.status).toBe(401)
  })

  test('T-PLN-API-053 refuses an account that has not activated its Fitness ID', async () => {
    // Not an empty catalogue: everything here is keyed on the person, and there is
    // no person yet. That is a precondition, not an absence.
    const response = await harness({
      actors: {
        personFor: async () => {
          throw new SpaceActorError('registration-incomplete')
        },
      },
    }).request('/space/v1/programs', { headers: authorized })

    expect(response.status).toBe(403)
  })
})

describe('GET /space/v1/programs/{programVersionId}', () => {
  test('T-PLN-API-060 answers the whole content of the version', async () => {
    const response = await harness().request(`/space/v1/programs/${VERSION_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(detail)
  })

  test('T-PLN-API-061 refuses an identifier that is not a version', async () => {
    const response = await harness().request('/space/v1/programs/not-a-uuid', {
      headers: authorized,
    })
    expect(response.status).toBe(400)
  })

  test('T-PLN-API-062 answers not-found for a version this person may not read', async () => {
    // Absent and forbidden are deliberately the same answer: otherwise the catalogue
    // of every organization becomes enumerable one identifier at a time.
    const response = await harness({ service: { readProgram: async () => null } }).request(
      `/space/v1/programs/${VERSION_ID}`,
      { headers: authorized },
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /space/v1/assignments', () => {
  const choose = (body: unknown, headers: Record<string, string> = commanded) =>
    harness().request('/space/v1/assignments', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

  test('T-PLN-API-054 answers the assignment and how many sessions it planned', async () => {
    const response = await choose({
      program_version_id: VERSION_ID,
      timezone: 'America/Bogota',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(assignment)
  })

  test('T-PLN-API-055 refuses a body carrying anything else', async () => {
    // A start date is the one a client must never send: it would let a plan be
    // backdated into a history that never happened.
    const response = await choose({
      program_version_id: VERSION_ID,
      timezone: 'America/Bogota',
      starts_on: '2020-01-01',
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-056 refuses a blank timezone', async () => {
    const response = await choose({ program_version_id: VERSION_ID, timezone: '   ' })
    expect(response.status).toBe(400)
  })

  test('T-PLN-API-057 refuses without command headers', async () => {
    const response = await choose(
      { program_version_id: VERSION_ID, timezone: 'America/Bogota' },
      { ...authorized, 'content-type': 'application/json' },
    )
    expect(response.status).toBe(400)
  })

  test('T-PLN-API-058 answers forbidden for a version the person may not reach', async () => {
    const response = await harness({
      service: {
        chooseProgram: async () => {
          throw Object.assign(new Error('not yours'), { code: '42501' })
        },
      },
    }).request('/space/v1/assignments', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ program_version_id: VERSION_ID, timezone: 'America/Bogota' }),
    })

    expect(response.status).toBe(403)
  })

  test('T-PLN-API-059 answers invalid-request for a timezone PostgreSQL does not know', async () => {
    const response = await harness({
      service: {
        chooseProgram: async () => {
          throw Object.assign(new Error('invalid timezone'), { code: '22023' })
        },
      },
    }).request('/space/v1/assignments', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ program_version_id: VERSION_ID, timezone: 'Mars/Olympus' }),
    })

    expect(response.status).toBe(400)
  })
})
