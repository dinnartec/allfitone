import { describe, expect, test } from 'bun:test'

import { createSpacePlanningService } from './space.js'
import type { Program, SpacePlanningDatabase, WeekPlan } from '../domain/space.js'

const ASSIGNMENT_ID = '019f9000-0000-7000-8000-000000000011'
const VERSION_ID = '019f3000-0000-7000-8000-000000000006'

function routine(done: boolean, id: string) {
  return {
    planned_session_id: id,
    title: 'Empuje',
    discipline_code: 'strength',
    status: done ? ('completed' as const) : ('scheduled' as const),
    program_day: 1,
    scheduled_at: '2026-08-31T10:00:00Z',
    exercise_count: 5,
    set_count: 16,
    done,
    open_execution_id: null,
  }
}

function plan(sessions: WeekPlan['sessions']): WeekPlan {
  return {
    assignment_id: ASSIGNMENT_ID,
    program_version_id: VERSION_ID,
    program_title: 'Torso y pierna',
    program_week: 2,
    week_starts_on: '2026-08-31',
    sessions,
  }
}

/** Only the one read matters here; the rest would be noise. */
function service(readWeekPlan: SpacePlanningDatabase['readWeekPlan']) {
  return createSpacePlanningService(
    { readWeekPlan } as unknown as SpacePlanningDatabase,
    'https://media.test/catalog',
  )
}

const input = { personId: 'p', timezone: 'America/Bogota', requestId: 'r' }

describe('readWeekProgress', () => {
  test('counts the selected programme, not everything the person follows', async () => {
    // The defect this replaces: `execution.read_week_summary` counted
    // `planning.planned_sessions` by person and week alone, so somebody following a
    // one-session programme and a four-session one saw "0 de 5" under the name of the
    // first. The week plan is already scoped to the assignment the tab opens on.
    const one = service(async () => plan([routine(false, 'a')]))

    await expect(one.readWeekProgress(input)).resolves.toEqual({
      sessions_planned: 1,
      sessions_completed: 0,
    })
  })

  test('counts a closed execution as done, whatever the planned status says', async () => {
    // `done` is whether a completed execution exists. A session can be reopened and
    // redone, so its own status is not the answer.
    const two = service(async () => plan([routine(true, 'a'), routine(false, 'b')]))

    await expect(two.readWeekProgress(input)).resolves.toEqual({
      sessions_planned: 2,
      sessions_completed: 1,
    })
  })

  test('answers zero of zero with no programme, rather than failing', async () => {
    // The screen has a state for having nothing planned; an error here would replace it
    // with a failure the person cannot act on.
    const none = service(async () => null)

    await expect(none.readWeekProgress(input)).resolves.toEqual({
      sessions_planned: 0,
      sessions_completed: 0,
    })
  })

  test('a rest week is zero planned, not the absence of a week', async () => {
    const empty = service(async () => plan([]))

    await expect(empty.readWeekProgress(input)).resolves.toEqual({
      sessions_planned: 0,
      sessions_completed: 0,
    })
  })
})

describe('publishAndRestate', () => {
  const command = {
    personId: 'p',
    programId: 'g',
    expectedEtag: 'etag',
    timezone: 'America/Bogota',
    idempotencyKey: 'key',
    commandId: 'command',
    requestHash: Buffer.from('hash'),
  }

  /** Records what each command was called with; nothing else here is exercised. */
  function publisher(restated: string | null) {
    const calls: string[] = []
    const taken: { timezone: string }[] = []
    const database = {
      publishMyProgram: async () => {
        calls.push('publish')
        return { id: VERSION_ID } as never
      },
      restateMyProgramAssignment: async () => {
        calls.push('restate')
        return restated
      },
      selfAssignProgram: async (input: { timezone: string }) => {
        calls.push('take')
        taken.push(input)
        return {} as never
      },
    } as unknown as SpacePlanningDatabase
    return {
      service: createSpacePlanningService(database, 'https://media.test/catalog'),
      calls,
      taken,
    }
  }

  test('takes the programme when nothing was following it, so publishing is not invisible', async () => {
    const first = publisher(null)

    await first.service.publishAndRestate(command)

    expect(first.calls).toEqual(['publish', 'restate', 'take'])
    expect(first.taken[0]?.timezone).toBe('America/Bogota')
  })

  test('leaves the agenda alone when the restate moved it, rather than assigning twice', async () => {
    // The defect: the editor took the programme after every publication, so editing one
    // already followed produced a second assignment starting today with nothing trained.
    // It sorted in front, and both tabs read a progress that never moved while the
    // sessions being trained counted on the other one.
    const again = publisher(ASSIGNMENT_ID)

    await again.service.publishAndRestate(command)

    expect(again.calls).toEqual(['publish', 'restate'])
  })
})

describe('removeMyProgram y duplicateMyProgram', () => {
  const command = {
    personId: 'p',
    programId: 'g',
    idempotencyKey: 'key',
    commandId: 'command',
    requestHash: Buffer.from('hash'),
  }

  const draft = {
    id: '019f9000-0000-7000-8000-000000000054',
    program_id: 'g',
    etag: `"sha256:${'A'.repeat(43)}"`,
    content_schema_version: 1,
    deprecated_template_version_ids: [],
    updated_at: '2026-09-20T07:00:00.000Z',
    content: { title: 'Torso y pierna', notes: null, sessions: [] },
  } as Program['draft']

  const archived = {
    id: 'g',
    organization_id: null,
    status: 'archived',
    author_person_id: 'p',
    draft,
    versions: [],
  } as Program
  const copy = { ...archived, id: 'copy', status: 'draft' } as Program

  /** Sólo interesan las dos órdenes; lo demás sería ruido. */
  function commands() {
    const asked: unknown[] = []
    const database = {
      removeMyProgram: async (input: unknown) => {
        asked.push(input)
        return archived
      },
      duplicateMyProgram: async (input: unknown) => {
        asked.push(input)
        return copy
      },
    } as unknown as SpacePlanningDatabase
    return { service: createSpacePlanningService(database, 'https://media.test/catalog'), asked }
  }

  test('la respuesta del que llama viaja entera, y `false` es una respuesta', async () => {
    // Si el servicio pusiera un valor por defecto, eliminar un programa se llevaría
    // rutinas que nadie aceptó perder. Quien decide es la persona, no esta capa.
    const { service, asked } = commands()

    await service.removeMyProgram({ ...command, withRoutines: false })

    expect(asked[0]).toEqual({ ...command, withRoutines: false })
  })

  test('duplicar contesta el programa nuevo, que no es el copiado', async () => {
    const { service } = commands()

    await expect(service.duplicateMyProgram(command)).resolves.toEqual(copy)
  })

  test('ninguna de las dos toca la dirección de los medios: no contestan portadas', async () => {
    // El servicio compone direcciones sólo donde la fila trae una clave guardada. Un
    // programa no la trae, así que pasa tal cual y nada se le añade.
    const { service } = commands()

    await expect(service.removeMyProgram({ ...command, withRoutines: true })).resolves.toEqual(
      archived,
    )
  })
})

describe('readMyPrograms', () => {
  /**
   * La clave direcciona nuestro almacenamiento y no sale nunca; lo que sale es dónde
   * pedirla. Si el servicio no compusiera, el cliente tendría que saber dónde viven los
   * objetos, que es justo lo que `ADR-031` mantiene fuera del dato.
   */
  const stored = {
    assignment_id: 'a1',
    program_version_id: 'pv1',
    program_id: 'p1',
    editable: false,
    title: 'Fuerza básica',
    weeks: 8,
    days_per_week: 3,
    starts_on: '2026-09-14',
    sessions_done: 0,
    sessions_planned: 24,
  }

  function withPrograms(coverKey: string | null) {
    const database = {
      readMyPrograms: async () => [{ ...stored, cover_object_key: coverKey }],
    } as unknown as SpacePlanningDatabase
    return createSpacePlanningService(database, 'https://media.test/catalog/')
  }

  test('composes the artwork address out of the stored key and the media origin', async () => {
    const [program] = await withPrograms('programs/p1/abc.webp').readMyPrograms({
      personId: 'p',
      requestId: 'r',
    })

    expect(program?.cover_url).toBe('https://media.test/catalog/programs/p1/abc.webp')
    // La barra de más del origen no se convierte en una doble en la dirección.
    expect(program?.cover_url).not.toContain('//programs')
  })

  test('answers null for a programme with no artwork, which is what your own one is', async () => {
    const [program] = await withPrograms(null).readMyPrograms({ personId: 'p', requestId: 'r' })

    expect(program?.cover_url).toBeNull()
  })

  test('hands a programme with no end date through with its weeks still null', async () => {
    // Null is the answer, not a missing number: defaulting it would invent a duration.
    const database = {
      readMyPrograms: async () => [{ ...stored, weeks: null, cover_object_key: null }],
    } as unknown as SpacePlanningDatabase
    const [program] = await createSpacePlanningService(
      database,
      'https://media.test/catalog/',
    ).readMyPrograms({ personId: 'p', requestId: 'r' })

    expect(program?.weeks).toBeNull()
  })

  test('never lets the storage key reach the answer', async () => {
    const [program] = await withPrograms('programs/p1/abc.webp').readMyPrograms({
      personId: 'p',
      requestId: 'r',
    })

    expect(Object.keys(program ?? {})).not.toContain('cover_object_key')
  })
})

describe('readMyContent y el borrador', () => {
  /**
   * La misma regla que el programa, y por el mismo `ADR-031`: la fila guarda la clave y
   * quien contesta compone la dirección. Si el cliente tuviera que componerla, sabría
   * dónde viven los objetos, que es justo lo que la decisión mantiene fuera del dato.
   */
  const storedRoutine = {
    template_id: 't1',
    title: 'Empuje',
    discipline_code: 'strength',
    status: 'published',
    template_version_id: 'v1',
    cover: { kind: 'photo' as const },
    muscles: ['chest'],
    versions: ['v1'],
    programs: [],
    exercise_count: 3,
    set_count: 13,
    has_unpublished_changes: false,
  }

  function service(coverKey: string | null) {
    const database = {
      readMyContent: async () => [{ ...storedRoutine, cover_object_key: coverKey }],
    } as unknown as SpacePlanningDatabase
    return createSpacePlanningService(database, 'https://media.test/catalog')
  }

  const asking = { personId: 'p', requestId: 'r' }

  test('a routine answers where to fetch its photograph, never the key', async () => {
    const [routine] = await service('programs/p1/abc.webp').readMyContent(asking)

    expect(routine?.cover_url).toBe('https://media.test/catalog/programs/p1/abc.webp')
    expect(Object.keys(routine ?? {})).not.toContain('cover_object_key')
  })

  test('and null when nothing was picked, which is a routine with no exercises yet', async () => {
    const [routine] = await service(null).readMyContent(asking)

    expect(routine?.cover_url).toBeNull()
  })
})
