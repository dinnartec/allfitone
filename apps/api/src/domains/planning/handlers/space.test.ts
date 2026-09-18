import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { SpaceExecutionService } from '../../execution/index.js'
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
  program_id: PROGRAM_ID,
  editable: true,
  title: 'Torso y pierna',
  weeks: 10,
  days_per_week: 4,
  starts_on: '2026-08-31',
  sessions_done: 1,
  sessions_planned: 40,
}

const PHOTO_ID = '019f9000-0000-7000-8000-0000000000c1'

/** Not a real image: the handler serves what the database answered, whatever it is. */
const STORED_PHOTO = Buffer.from('RIFF....WEBP')

const myRoutine: MyRoutine = {
  template_id: TEMPLATE_ID,
  title: 'Empuje',
  discipline_code: 'test_strength',
  status: 'published',
  template_version_id: '019f9000-0000-7000-8000-000000000043',
  cover: { kind: 'icon', icon: 'strength' },
  muscles: ['chest', 'triceps'],
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

/**
 * What Execution answers for the week. Its two session counts are person-wide — every
 * programme at once — which is exactly why `/today` must not use them: the screen names
 * one programme. The numbers here are deliberately wrong for the selected programme so
 * a test can prove they were not the ones that came out.
 */
const weekSummary = {
  trained_seconds: 2700,
  sessions_completed: 3,
  sessions_planned: 5,
  latest_weight: null,
  history: [],
}

function harness(overrides?: {
  service?: Partial<SpacePlanningService>
  actors?: Partial<SpaceActorResolver>
  executions?: Partial<SpaceExecutionService>
}): Hono {
  const service: SpacePlanningService = {
    readCatalogue: async () => catalogue,
    createMySessionTemplate: async () => template,
    replaceMySessionTemplateDraft: async () => templateDraft,
    publishMySessionTemplate: async () => ({}) as never,
    readMySessionTemplateDraft: async () => templateDraft,
    discardMySessionTemplate: async () => template,
    storeMyCoverPhoto: async () => ({ id: PHOTO_ID }),
    readMyCoverPhoto: async () => ({
      content_type: 'image/webp',
      byte_size: STORED_PHOTO.length,
      bytes: STORED_PHOTO,
    }),
    discardMyProgram: async () => program,
    readMyUnpublishedProgram: async () => program,
    createMyProgram: async () => program,
    replaceMyProgramDraft: async () => programDraft,
    publishMyProgram: async () => ({}) as never,
    readWeekPlan: async () => weekPlan,
    readWeekProgress: async () => ({ sessions_planned: 1, sessions_completed: 0 }),
    readMyPrograms: async () => [myProgram],
    readMyProgramDraft: async () => programDraft,
    publishAndRestate: async () => ({}) as never,
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
  const executions = {
    readWeekSummary: async () => weekSummary,
    ...overrides?.executions,
  } as unknown as SpaceExecutionService
  const app = new Hono()
  app.route(
    '/space/v1',
    spacePlanningRoutes(
      service,
      async () => ({ subject: 'sub', sessionId: 'sid', surface: 'space' as const }),
      actors,
      executions,
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
        operation.path.startsWith('/space/v1/session-templates') ||
        operation.path.startsWith('/space/v1/routine-covers'),
    )
    expect(declared).toHaveLength(19)
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
      // Reading a routine back in the shape it is edited in. Without it a saved
      // draft is unreachable: it exists, it counts, and nothing can open it.
      'OP-PLN-023',
      'OP-PLN-024',
      // Reading a programme back in the shape it is edited in, which is the one
      // thing no other operation answers.
      'OP-PLN-026',
      // Throwing a routine away, as a state and never as a deletion.
      'OP-PLN-028',
      // And the same for a programme, so one somebody abandons is not orphaned.
      'OP-PLN-029',
      // Finding that programme again, which no other query could: every one of them
      // starts from an assignment, and an unpublished programme has none.
      'OP-PLN-030',
      // A photograph for a routine's cover, sanitised before it is stored…
      'OP-PLN-031',
      // …and served back through the API, never from a store.
      'OP-PLN-032',
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

describe('the cover photograph', () => {
  const upload = {
    method: 'POST',
    headers: {
      ...authorized,
      'content-type': 'application/json',
      'idempotency-key': '8d1f0a44-1111-4111-8111-000000000001',
      'command-id': '019f9000-0000-7000-8000-0000000000d1',
    },
  }

  const jpeg = async () =>
    (await import('sharp'))
      .default({
        create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 10, b: 10 } },
      })
      .jpeg()
      .toBuffer()

  test('T-PLN-API-137 an image is sanitised and stored, and answers its identifier', async () => {
    const response = await harness().request(
      `/space/v1/session-templates/${TEMPLATE_ID}/cover-photo`,
      {
        ...upload,
        body: JSON.stringify({
          content_type: 'image/jpeg',
          content: (await jpeg()).toString('base64'),
        }),
      },
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: PHOTO_ID })
  })

  test('T-PLN-API-138 something that is not an image is refused and stores nothing', async () => {
    let stored = false
    const watching = harness({
      service: {
        storeMyCoverPhoto: async () => {
          stored = true
          return { id: PHOTO_ID }
        },
      },
    })
    const response = await watching.request(
      `/space/v1/session-templates/${TEMPLATE_ID}/cover-photo`,
      {
        ...upload,
        body: JSON.stringify({
          content_type: 'image/jpeg',
          content: Buffer.from('no soy una foto').toString('base64'),
        }),
      },
    )

    expect(response.status).toBe(422)
    // The point of the assertion: failing closed means the command never ran.
    expect(stored).toBe(false)
  })

  test('T-PLN-API-139 the bytes come back as an image and are never cached', async () => {
    const response = await harness().request(`/space/v1/routine-covers/${PHOTO_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(STORED_PHOTO)
  })

  test("T-PLN-API-140 and somebody else's photograph is not found rather than forbidden", async () => {
    // The two are the same answer on purpose: telling them apart would let identifiers
    // be walked until one of them existed.
    const none = harness({ service: { readMyCoverPhoto: async () => null } })
    const response = await none.request(`/space/v1/routine-covers/${PHOTO_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(404)
  })
})

describe('GET /space/v1/my-content', () => {
  test('T-PLN-API-100 answers the routines this person has made', async () => {
    const response = await harness().request('/space/v1/my-content', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([myRoutine])
  })

  test('T-PLN-API-127 hands the cover through untouched, including having none', async () => {
    // The list draws it, so the handler must not summarise it. A cover the API
    // flattened to a string would be a cover the screen cannot tell apart from a name.
    const bare = harness({
      service: {
        readMyContent: async () => [{ ...myRoutine, cover: null, muscles: [] }],
      },
    })
    const response = await bare.request('/space/v1/my-content', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ ...myRoutine, cover: null, muscles: [] }])
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
    const response = await harness().request(
      `/space/v1/programs/${PROGRAM_ID}/versions?timezone=America%2FBogota`,
      { method: 'POST', headers: commanded },
    )

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-111 refuses to publish without a zone, which an assignment would need', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/versions`, {
      method: 'POST',
      headers: commandedEtag,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-112 passes the zone on, so a first publication starts today where you are', async () => {
    let seen: string | undefined
    const app = harness({
      service: {
        publishAndRestate: async (input) => {
          seen = input.timezone
          return {} as never
        },
      },
    })

    const response = await app.request(
      `/space/v1/programs/${PROGRAM_ID}/versions?timezone=America%2FBogota`,
      { method: 'POST', headers: commandedEtag },
    )

    expect(response.status).toBe(201)
    expect(seen).toBe('America/Bogota')
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

describe('GET /space/v1/today', () => {
  test('T-PLN-API-103 counts the selected programme, not everything the person follows', async () => {
    // The defect: Execution's counts are by person and week, so a one-session programme
    // read `0 de 5` under its own name because a second programme added four. Planning
    // answers what is planned; Execution answers what was trained.
    const response = await harness().request('/space/v1/today?timezone=America/Bogota', {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      week: { sessions_planned: number; sessions_completed: number; trained_seconds: number }
    }
    expect(body.week.sessions_planned).toBe(1)
    expect(body.week.sessions_completed).toBe(0)
    // And what Execution does own still comes through.
    expect(body.week.trained_seconds).toBe(2700)
  })

  test('T-PLN-API-104 refuses a request with no timezone, because today is local', async () => {
    const response = await harness().request('/space/v1/today', { headers: authorized })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-105 requires a bearer token', async () => {
    const response = await harness().request('/space/v1/today?timezone=America/Bogota')

    expect(response.status).toBe(401)
  })

  test('T-PLN-API-106 answers forbidden for an unactivated Fitness ID', async () => {
    const response = await harness(unregistered).request(
      '/space/v1/today?timezone=America/Bogota',
      {
        headers: authorized,
      },
    )

    expect(response.status).toBe(403)
  })
})

describe('GET /space/v1/programs/{programId}/draft', () => {
  test('T-PLN-API-107 answers the draft with the etag the next save has to send', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/draft`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe(programDraft.etag)
    expect(await response.json()).toEqual(programDraft)
  })

  test('T-PLN-API-108 answers not-found for a programme with no draft', async () => {
    // A programme taken from Allfit was forked and never given a draft. It is not a
    // permission problem, and it answers the same as somebody else's programme:
    // separating them would let identifiers be walked to learn what exists.
    const none = harness({ service: { readMyProgramDraft: async () => null } })
    const response = await none.request(`/space/v1/programs/${PROGRAM_ID}/draft`, {
      headers: authorized,
    })

    expect(response.status).toBe(404)
  })

  test('T-PLN-API-109 refuses an identifier that is not a programme', async () => {
    const response = await harness().request('/space/v1/programs/nope/draft', {
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-110 requires a bearer token', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/draft`)

    expect(response.status).toBe(401)
  })
})

describe('GET /space/v1/session-templates/{templateId}/draft', () => {
  test('T-PLN-API-113 answers the draft with the etag the next save has to send', async () => {
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe(templateDraft.etag)
    expect(await response.json()).toEqual(templateDraft)
  })

  test('T-PLN-API-114 answers not-found for a routine that is not mine, discarded, or gone', async () => {
    // The three cases answer the same on purpose. Telling them apart would let
    // identifiers be walked to learn which routines exist.
    const none = harness({ service: { readMySessionTemplateDraft: async () => null } })
    const response = await none.request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`, {
      headers: authorized,
    })

    expect(response.status).toBe(404)
  })

  test('T-PLN-API-115 refuses an identifier that is not a routine', async () => {
    const response = await harness().request('/space/v1/session-templates/nope/draft', {
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-116 requires a bearer token', async () => {
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/draft`)

    expect(response.status).toBe(401)
  })
})

describe('POST /space/v1/session-templates/{templateId}/discard', () => {
  test('T-PLN-API-117 answers the archived routine', async () => {
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/discard`, {
      method: 'POST',
      headers: commanded,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(template)
  })

  test('T-PLN-API-118 refuses a discard with no command headers', async () => {
    // Discarding is a command and converges on replay, which is what the headers are
    // for. Without them a retry after a timeout would be a second, unrelated discard.
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/discard`, {
      method: 'POST',
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-119 requires a bearer token', async () => {
    const response = await harness().request(`/space/v1/session-templates/${TEMPLATE_ID}/discard`, {
      method: 'POST',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY, 'command-id': COMMAND_ID },
    })

    expect(response.status).toBe(401)
  })
})

describe('POST /space/v1/programs/{programId}/discard', () => {
  test('T-PLN-API-120 answers the archived programme', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/discard`, {
      method: 'POST',
      headers: commanded,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(program)
  })

  test('T-PLN-API-121 refuses a discard with no command headers', async () => {
    // The twin of the routine's. Without them a retry after a timeout would be a
    // second, unrelated discard.
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/discard`, {
      method: 'POST',
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-122 refuses an identifier that is not a UUIDv7', async () => {
    const response = await harness().request('/space/v1/programs/not-a-uuid/discard', {
      method: 'POST',
      headers: commanded,
    })

    expect(response.status).toBe(400)
  })

  test('T-PLN-API-123 requires a bearer token', async () => {
    const response = await harness().request(`/space/v1/programs/${PROGRAM_ID}/discard`, {
      method: 'POST',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY, 'command-id': COMMAND_ID },
    })

    expect(response.status).toBe(401)
  })
})

describe('GET /space/v1/programs/unpublished', () => {
  test('T-PLN-API-124 answers the programme somebody left unpublished', async () => {
    const response = await harness().request('/space/v1/programs/unpublished', {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(program)
  })

  test('T-PLN-API-125 is read as a word and not as an identifier', async () => {
    // Registered after `/programs/:programId`, this path would be taken for a
    // programme called «unpublished» and answered with a 400 for a bad UUID.
    const response = await harness().request('/space/v1/programs/unpublished', {
      headers: authorized,
    })

    expect(response.status).not.toBe(400)
  })

  test('T-PLN-API-126 requires a bearer token', async () => {
    const response = await harness().request('/space/v1/programs/unpublished')

    expect(response.status).toBe(401)
  })
})
