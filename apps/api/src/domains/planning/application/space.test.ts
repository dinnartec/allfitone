import { describe, expect, test } from 'bun:test'

import { createSpacePlanningService } from './space.js'
import type { SpacePlanningDatabase, WeekPlan } from '../domain/space.js'

const ASSIGNMENT_ID = '019f9000-0000-7000-8000-000000000011'
const VERSION_ID = '019f3000-0000-7000-8000-000000000006'

function routine(done: boolean, id: string) {
  return {
    planned_session_id: id,
    title: 'Empuje',
    discipline_code: 'strength',
    status: done ? ('completed' as const) : ('scheduled' as const),
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
  return createSpacePlanningService({ readWeekPlan } as unknown as SpacePlanningDatabase)
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
    return { service: createSpacePlanningService(database), calls, taken }
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
