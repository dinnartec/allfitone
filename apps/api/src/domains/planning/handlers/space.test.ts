import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { ProgramCatalogue, SpacePlanningService } from '../application/space.js'
import type {
  MyProgram,
  MyRoutine,
  Program,
  ProgramAssignment,
  ProgramDetail,
  ProgramDraft,
  SessionTemplate,
  SessionTemplateDraft,
  WeekPlan,
} from '../domain/space.js'
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

const SESSION_ID = '019f9000-0000-7000-8000-000000000031'
const TEMPLATE_ID = '019f9000-0000-7000-8000-000000000041'
const PROGRAM_ID = '019f9000-0000-7000-8000-000000000051'
const ETAG = `"sha256:${'A'.repeat(43)}"`

const templateDraft = {
  id: '019f9000-0000-7000-8000-000000000042',
  template_id: TEMPLATE_ID,
  etag: ETAG,
  content_schema_version: 1,
  derived_from_version_id: null,
  updated_at: '2026-08-31T07:00:00.000Z',
  content: { title: 'Empuje', activity_type_id: null, steps: [] },
} as SessionTemplateDraft

const template = {
  id: TEMPLATE_ID,
  organization_id: null,
  discipline_code: 'test_strength',
  status: 'draft',
  author_person_id: PERSON_ID,
  draft: templateDraft,
  versions: [],
} as SessionTemplate

const programDraft = {
  id: '019f9000-0000-7000-8000-000000000052',
  program_id: PROGRAM_ID,
  etag: ETAG,
  content_schema_version: 1,
  deprecated_template_version_ids: [],
  updated_at: '2026-08-31T07:00:00.000Z',
  content: { title: 'Mi programa', notes: null, sessions: [] },
} as ProgramDraft

const program = {
  id: PROGRAM_ID,
  organization_id: null,
  status: 'draft',
  author_person_id: PERSON_ID,
  draft: programDraft,
  versions: [],
} as Program

const weekPlan: WeekPlan = {
  assignment_id: ASSIGNMENT_ID,
  program_version_id: VERSION_ID,
  program_title: 'Torso y pierna',
  program_week: 2,
  week_starts_on: '2026-08-31',
  sessions: [
    {
      planned_session_id: SESSION_ID,
      title: 'Empuje',
      discipline_code: 'strength',
      status: 'completed',
      exercise_count: 5,
      set_count: 16,
      done: true,
      open_execution_id: null,
    },
  ],
}

const myProgram: MyProgram = {
  assignment_id: ASSIGNMENT_ID,
  program_version_id: VERSION_ID,
  title: 'Torso y pierna',
  weeks: 10,
  days_per_week: 4,
  starts_on: '2026-08-31',
  sessions_done: 1,
  sessions_planned: 40,
}

const myRoutine: MyRoutine = {
  template_id: TEMPLATE_ID,
  title: 'Empuje',
  discipline_code: 'test_strength',
  status: 'published',
  template_version_id: '019f9000-0000-7000-8000-000000000043',
  exercise_count: 4,
  set_count: 11,
  has_unpublished_changes: false,
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
    createMySessionTemplate: async () => template,
    replaceMySessionTemplateDraft: async () => templateDraft,
    publishMySessionTemplate: async () => ({}) as never,
    createMyProgram: async () => program,
    replaceMyProgramDraft: async () => programDraft,
    publishMyProgram: async () => ({}) as never,
    readWeekPlan: async () => weekPlan,
    readMyPrograms: async () => [myProgram],
    readMyContent: async () => [myRoutine],
    reorderMyPrograms: async () => [myProgram],
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

const unregistered = {
  actors: {
    actorFor: async () => {
      throw new SpaceActorError('registration-incomplete')
    },
    personFor: async () => {
      throw new SpaceActorError('registration-incomplete')
    },
  },
}

const authorized = { authorization: 'Bearer token' }
const commanded = {
  ...authorized,
  'content-type': 'application/json',
  'idempotency-key': IDEMPOTENCY_KEY,
  'command-id': COMMAND_ID,
}

describe('the Space planning surface honours the contract', () => {
  test('T-PLN-API-050 every route is declared with its operation', () => {
    const declared = allfitV1ContractManifest.operations.filter(
      (operation) =>
        operation.path.startsWith('/space/v1/programs') ||
        operation.path.startsWith('/space/v1/assignments') ||
        operation.path.startsWith('/space/v1/week-plan') ||
        operation.path.startsWith('/space/v1/session-templates'),
    )
    expect(declared).toHaveLength(12)
    expect(declared.map((operation) => operation.allfitOperation).sort()).toEqual([
      'OP-PLN-001',
      'OP-PLN-002',
      'OP-PLN-003',
      'OP-PLN-006',
      'OP-PLN-007',
      'OP-PLN-008',
      'OP-PLN-011',
      // Listing the catalogue and listing what the person owns are the same
      // operation seen from two surfaces.
      'OP-PLN-020',
      'OP-PLN-020',
      'OP-PLN-021',
      'OP-PLN-022',
      'OP-PLN-024',
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

describe('GET /space/v1/my-content', () => {
  test('T-PLN-API-100 answers the routines this person has made', async () => {
    const response = await harness().request('/space/v1/my-content', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([myRoutine])
  })

  test('T-PLN-API-101 answers an empty list rather than not-found', async () => {
    // Somebody who has made nothing is not an error; it is `PR-4`.
    const none = harness({ service: { readMyContent: async () => [] } })
    const response = await none.request('/space/v1/my-content', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  test('T-PLN-API-102 refuses an account that has not activated its Fitness ID', async () => {
    const response = await harness(unregistered).request('/space/v1/my-content', {
      headers: authorized,
    })

    expect(response.status).toBe(403)
  })
})

describe('GET /space/v1/week-plan', () => {
  test('T-PLN-API-080 answers the week and its routines', async () => {
    const response = await harness().request('/space/v1/week-plan?timezone=America/Bogota', {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(weekPlan)
  })

  test('T-PLN-API-081 refuses without a zone, because a week is a local question', async () => {
    expect((await harness().request('/space/v1/week-plan', { headers: authorized })).status).toBe(
      400,
    )
  })

  test('T-PLN-API-082 answers not-found when there is no programme', async () => {
    // Not an empty week: a person with no programme is a different screen.
    const none = harness({ service: { readWeekPlan: async () => null } })
    const response = await none.request('/space/v1/week-plan?timezone=America/Bogota', {
      headers: authorized,
    })

    expect(response.status).toBe(404)
  })
})

describe('GET /space/v1/programs/mine', () => {
  test('T-PLN-API-083 answers the programmes this person owns', async () => {
    const response = await harness().request('/space/v1/programs/mine', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([myProgram])
  })

  test('T-PLN-API-084 refuses an account that has not activated its Fitness ID', async () => {
    const response = await harness(unregistered).request('/space/v1/programs/mine', {
      headers: authorized,
    })

    expect(response.status).toBe(403)
  })
})

describe('PUT /space/v1/programs/mine/order', () => {
  const order = (body: unknown, headers: Record<string, string> = commanded) =>
    harness().request('/space/v1/programs/mine/order', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

  test('T-PLN-API-085 answers the order as it now stands', async () => {
    const response = await order({ assignment_ids: [ASSIGNMENT_ID] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([myProgram])
  })

  test('T-PLN-API-086 refuses an order that repeats an assignment', async () => {
    expect((await order({ assignment_ids: [ASSIGNMENT_ID, ASSIGNMENT_ID] })).status).toBe(400)
  })

  test('T-PLN-API-087 refuses an empty order, which is not an order', async () => {
    expect((await order({ assignment_ids: [] })).status).toBe(400)
  })

  test('T-PLN-API-088 refuses without command headers', async () => {
    const response = await order(
      { assignment_ids: [ASSIGNMENT_ID] },
      {
        ...authorized,
        'content-type': 'application/json',
      },
    )

    expect(response.status).toBe(400)
  })
})

describe('the six that make content mine', () => {
  const commandedEtag = { ...commanded, 'if-match': ETAG }

  test('T-PLN-API-090 creating a routine answers its identity and its empty draft', async () => {
    const response = await harness().request('/space/v1/session-templates', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ discipline_code: 'test_strength', title: 'Empuje' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(template)
    expect(response.headers.get('location')).toBe(`/space/v1/session-templates/${TEMPLATE_ID}`)
  })

  test('T-PLN-API-091 refuses a routine with no discipline', async () => {
    const response = await harness().request('/space/v1/session-templates', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ title: 'Empuje' }),
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-092 saving the draft answers the draft and its ETag', async () => {
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`, {
      method: 'PUT',
      headers: commandedEtag,
      body: JSON.stringify({ title: 'Empuje', activity_type_id: null, steps: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(templateDraft)
  })

  test('T-PLN-API-093 refuses to save a draft without the ETag it is editing', async () => {
    // Without it two devices would overwrite each other and neither would know.
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`, {
      method: 'PUT',
      headers: commanded,
      body: JSON.stringify({ title: 'Empuje', activity_type_id: null, steps: [] }),
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-094 answers conflict when the draft moved underneath', async () => {
    const stale = harness({
      service: {
        replaceMySessionTemplateDraft: async () => {
          throw Object.assign(new Error('stale-draft'), { code: '40001' })
        },
      },
    })
    const response = await stale.request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`, {
      method: 'PUT',
      headers: commandedEtag,
      body: JSON.stringify({ title: 'Empuje', activity_type_id: null, steps: [] }),
    })

    expect(response.status).toBe(409)
  })

  test('T-PLN-API-095 answers invalid-request when the routine is not publishable', async () => {
    // An empty routine is a legitimate draft and an illegitimate version.
    const empty = harness({
      service: {
        publishMySessionTemplate: async () => {
          throw Object.assign(new Error('incomplete session template draft'), { code: '22023' })
        },
      },
    })
    const response = await empty.request(`/space/v1/session-templates/${TEMPLATE_ID}/versions`, {
      method: 'POST',
      headers: commandedEtag,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-096 creating a programme answers its identity and its empty draft', async () => {
    const response = await harness().request('/space/v1/programs', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ title: 'Mi programa' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(program)
  })

  test('T-PLN-API-097 saving the programme draft answers it', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/draft`, {
      method: 'PUT',
      headers: commandedEtag,
      body: JSON.stringify({ title: 'Mi programa', notes: null, sessions: [] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(programDraft)
  })

  test('T-PLN-API-098 refuses to publish a programme without its ETag', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/versions`, {
      method: 'POST',
      headers: commanded,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-099 refuses an account that has not activated its Fitness ID', async () => {
    const response = await harness(unregistered).request('/space/v1/programs', {
      method: 'POST',
      headers: commanded,
      body: JSON.stringify({ title: 'Mi programa' }),
    })

    expect(response.status).toBe(403)
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
