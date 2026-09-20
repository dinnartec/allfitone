/**
 * What has to be true about making my own content.
 *
 * Two claims. The etag is carried from one save to the next without a screen holding
 * it, because a screen that forgets it turns a save into a `409`. And the base week of
 * `PR-1` expands into exactly the sessions a programme version stores — one entry per
 * session, position continuous across weeks, weekday preserved.
 */

import { describe, expect, test } from 'bun:test'

import {
  collapseBaseWeek,
  createContentFlow,
  expandBaseWeek,
  MissingEtagError,
  programLoad,
  revisedWeek,
  summarizeBaseWeek,
  weeksLabel,
  type ContentTransport,
} from './content'

const TEMPLATE_ID = '019f9000-0000-7000-8000-000000000041'
const PROGRAM_ID = '019f9000-0000-7000-8000-000000000051'
const VERSION_ID = '019f9000-0000-7000-8000-000000000061'

function harness(overrides: Partial<ContentTransport> = {}) {
  const sent: { command: string; etag?: string; timezone?: string }[] = []
  let issued = 0
  const command = () => ({
    idempotencyKey: `key-${(issued += 1)}`,
    commandId: `command-${issued}`,
  })
  const draft = (etag: string) => ({ etag }) as never

  const transport: ContentTransport = {
    searchMovements: async () => [],
    readEquipment: async () => [],
    readMuscles: async () => [],
    readMovement: async () => ({}) as never,
    readMyRoutines: async () => [],
    createTemplate: async (headers) => {
      sent.push({ command: headers.idempotencyKey })
      return { id: TEMPLATE_ID, draft: { etag: 'etag-1' } } as never
    },
    saveTemplateDraft: async (headers, _id, etag) => {
      sent.push({ command: headers.idempotencyKey, etag })
      return draft(`etag-${sent.length + 1}`)
    },
    publishTemplate: async (headers, _id, etag) => {
      sent.push({ command: headers.idempotencyKey, etag })
      return { id: VERSION_ID } as never
    },
    readTemplateDraft: async () => ({}) as never,
    discardTemplate: async () => ({}) as never,
    discardProgram: async () => ({}) as never,
    readMyUnpublishedProgram: async () => null,
    readProgramDraft: async (programId) =>
      ({ id: 'draft', program_id: programId, etag: 'opened-etag' }) as never,
    createProgram: async (headers) => {
      sent.push({ command: headers.idempotencyKey })
      return { id: PROGRAM_ID, draft: { etag: 'program-etag-1' } } as never
    },
    saveProgramDraft: async (headers, _id, etag) => {
      sent.push({ command: headers.idempotencyKey, etag })
      return draft('program-etag-2')
    },
    publishProgram: async (headers, _id, etag, timezone) => {
      sent.push({ command: headers.idempotencyKey, etag, timezone })
      return { id: VERSION_ID } as never
    },
    ...overrides,
  }

  return { flow: createContentFlow({ transport, newCommand: command }), sent }
}

const content = { title: 'Empuje', activity_type_id: null, steps: [] } as never

describe('the etag travels from one save to the next', () => {
  test('T-SP-CONTENT-01 creating a routine keeps the etag its draft answered with', async () => {
    const { flow } = harness()

    const template = await flow.createTemplate('strength', 'Empuje')

    expect(flow.etagFor(template.id)).toBe('etag-1')
  })

  test('T-SP-CONTENT-02 and every save sends the last one it was given', async () => {
    const { flow, sent } = harness()
    await flow.createTemplate('strength', 'Empuje')

    await flow.saveTemplateDraft(TEMPLATE_ID, content)
    await flow.saveTemplateDraft(TEMPLATE_ID, content)

    expect(sent.map((one) => one.etag)).toEqual([undefined, 'etag-1', 'etag-3'])
  })

  test('T-SP-CONTENT-03 saving without an etag refuses rather than sending none', async () => {
    // Sending no `If-Match` would be answered `400`, which reads as a bug in the screen.
    const { flow } = harness()

    await expect(flow.saveTemplateDraft(TEMPLATE_ID, content)).rejects.toBeInstanceOf(
      MissingEtagError,
    )
  })

  test('T-SP-CONTENT-04 each save is its own command, not a retry of the previous', async () => {
    const { flow, sent } = harness()
    await flow.createTemplate('strength', 'Empuje')

    await flow.saveTemplateDraft(TEMPLATE_ID, content)
    await flow.saveTemplateDraft(TEMPLATE_ID, content)

    expect(new Set(sent.map((one) => one.command)).size).toBe(sent.length)
  })

  test('T-SP-CONTENT-05 a failed creation retries under the same key', async () => {
    let attempts = 0
    const { flow, sent } = harness({
      createTemplate: async (headers) => {
        attempts += 1
        sent.push({ command: headers.idempotencyKey })
        if (attempts === 1) throw new Error('offline')
        return { id: TEMPLATE_ID, draft: { etag: 'etag-1' } } as never
      },
    })

    await expect(flow.createTemplate('strength', 'Empuje')).rejects.toThrow('offline')
    await flow.createTemplate('strength', 'Empuje')

    expect(sent[0]?.command).toBe(sent[1]?.command)
  })

  test('T-SP-CONTENT-06 publishing carries the etag of the draft being published', async () => {
    const { flow, sent } = harness()
    await flow.createProgram('Mi programa')

    await flow.saveProgramDraft(PROGRAM_ID, content)
    await flow.publishProgram(PROGRAM_ID, 'America/Bogota')

    expect(sent.at(-1)?.etag).toBe('program-etag-2')
  })

  test('T-SP-CONTENT-18 publishing carries the zone the assignment it may start needs', async () => {
    const { flow, sent } = harness()
    await flow.createProgram('Mi programa')

    await flow.publishProgram(PROGRAM_ID, 'America/Bogota')

    expect(sent.at(-1)?.timezone).toBe('America/Bogota')
  })
})

describe('the base week becomes the sessions a version stores', () => {
  const week = [
    { day: 1, templateVersionId: 'a' },
    { day: 2, templateVersionId: null },
    { day: 3, templateVersionId: 'b' },
    { day: 4, templateVersionId: null },
    { day: 5, templateVersionId: null },
    { day: 6, templateVersionId: null },
    { day: 7, templateVersionId: null },
  ]

  test('T-SP-CONTENT-07 an empty day is not a session', () => {
    expect(expandBaseWeek(week, 1)).toEqual([
      { position: 1, week: 1, day: 1, template_version_id: 'a' },
      { position: 2, week: 1, day: 3, template_version_id: 'b' },
    ])
  })

  test('T-SP-CONTENT-08 position is continuous across weeks and the weekday is not', () => {
    const sessions = expandBaseWeek(week, 3)

    expect(sessions).toHaveLength(6)
    expect(sessions.at(-1)).toEqual({ position: 6, week: 3, day: 3, template_version_id: 'b' })
  })

  test('T-SP-CONTENT-09 days come out in weekday order however they were filled', () => {
    const backwards = [
      { day: 5, templateVersionId: 'b' },
      { day: 2, templateVersionId: 'a' },
    ]

    expect(expandBaseWeek(backwards, 1).map((one) => one.day)).toEqual([2, 5])
  })

  test('T-SP-CONTENT-10 a week with nothing in it expands to nothing', () => {
    expect(expandBaseWeek([{ day: 1, templateVersionId: null }], 8)).toEqual([])
  })

  test('T-SP-CONTENT-11 the summary counts what is there, not the seven days', () => {
    expect(summarizeBaseWeek(week, 4)).toEqual({ daysPerWeek: 2, sessions: 8 })
  })
})

describe('and the sessions become the base week again', () => {
  const week = [
    { day: 1, templateVersionId: 'a' },
    { day: 2, templateVersionId: null },
    { day: 3, templateVersionId: 'b' },
    { day: 4, templateVersionId: null },
    { day: 5, templateVersionId: null },
    { day: 6, templateVersionId: null },
    { day: 7, templateVersionId: null },
  ]

  test('T-SP-CONTENT-12 a round trip returns exactly what went in', () => {
    // The guarantee the edit screen rests on. If this drifts, opening a programme to
    // rename it silently rewrites which routine each day trains.
    expect(collapseBaseWeek(expandBaseWeek(week, 6))).toEqual({ baseWeek: week, weeks: 6 })
  })

  test('T-SP-CONTENT-13 always seven days, so an empty one stays empty rather than absent', () => {
    const { baseWeek } = collapseBaseWeek([
      { position: 1, week: 1, day: 3, template_version_id: 'b' },
    ])

    expect(baseWeek).toHaveLength(7)
    expect(baseWeek.map((one) => one.day)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(baseWeek[2]).toEqual({ day: 3, templateVersionId: 'b' })
    expect(baseWeek[0]?.templateVersionId).toBeNull()
  })

  test('T-SP-CONTENT-14 the weeks are counted from the sessions, not assumed', () => {
    expect(collapseBaseWeek(expandBaseWeek(week, 1)).weeks).toBe(1)
    expect(collapseBaseWeek(expandBaseWeek(week, 52)).weeks).toBe(52)
  })

  test('T-SP-CONTENT-15 nothing at all is one empty week, not zero weeks', () => {
    // A programme with no days still repeats for as long as it says; answering zero
    // would put the stepper below its own minimum.
    expect(collapseBaseWeek([])).toEqual({
      baseWeek: week.map((day) => ({ day: day.day, templateVersionId: null })),
      weeks: 1,
    })
  })

  test('T-SP-CONTENT-16 only week one decides the base week', () => {
    // Weeks two and beyond are repeats. Reading them would double-count a day, and a
    // programme whose weeks differ is refused before it reaches here.
    const sessions = [
      { position: 1, week: 1, day: 1, template_version_id: 'a' },
      { position: 2, week: 2, day: 1, template_version_id: 'a' },
      { position: 3, week: 2, day: 5, template_version_id: 'c' },
    ]

    expect(collapseBaseWeek(sessions).baseWeek[4]?.templateVersionId).toBeNull()
  })
})

describe('opening a programme that already exists', () => {
  test('T-SP-CONTENT-17 remembers the etag, so the first save after opening is not refused', async () => {
    // Forgetting it is not a visible mistake: the save throws for a missing etag long
    // after somebody typed the thing they are about to lose.
    const { flow } = harness()

    await flow.openProgram(PROGRAM_ID)

    expect(flow.etagFor(PROGRAM_ID)).toBe('opened-etag')
  })
})

describe('what a programme amounts to', () => {
  test('T-SP-PROGRAM-20 one line, with every plural agreeing', () => {
    expect(programLoad(8, { daysPerWeek: 3, sessions: 24 })).toBe(
      '8 semanas · 3 días por semana · 24 sesiones',
    )
    expect(programLoad(1, { daysPerWeek: 1, sessions: 1 })).toBe(
      '1 semana · 1 día por semana · 1 sesión',
    )
  })

  test('T-SP-PROGRAM-21 a week with nothing in it says so rather than reporting zero', () => {
    // «0 días por semana · 0 sesiones» is arithmetic nobody asked for, and it reads as
    // a programme that is wrong rather than one that is not finished.
    expect(programLoad(8, { daysPerWeek: 0, sessions: 0 })).toBe(
      '8 semanas · sin días puestos todavía',
    )
  })

  test('T-SP-PROGRAM-22 the duration reads the same wherever it is drawn', () => {
    expect(weeksLabel(1)).toBe('1 semana')
    expect(weeksLabel(12)).toBe('12 semanas')
  })
})

describe('throwing a programme away', () => {
  test('T-SP-PROGRAM-23 discarding forgets its etag, so a later save cannot resurrect it', () => {
    // The etag is what the flow answers `If-Match` with. Kept after a discard, a stale
    // screen could save onto something the person meant to be gone.
    const { flow } = harness()
    flow.remember('program-1', '"sha256:kept"')

    return flow.discardProgram('program-1').then(() => {
      expect(flow.etagFor('program-1')).toBeUndefined()
    })
  })
})

describe('a routine republished while it sits in a week', () => {
  const week = [
    { day: 1, templateVersionId: 'v1' },
    { day: 3, templateVersionId: 'v2' },
    { day: 5, templateVersionId: 'v1' },
  ]

  test('T-SP-WEEK-10 keeps every day it was on, under its new version', () => {
    // The defect this closes: the week points at versions, publishing mints a new one,
    // and the routine vanished from the programme somebody was in the middle of
    // building — from its days and from the list of what the programme includes.
    expect(revisedWeek(week, 'v1', 'v9')).toEqual([
      { day: 1, templateVersionId: 'v9' },
      { day: 3, templateVersionId: 'v2' },
      { day: 5, templateVersionId: 'v9' },
    ])
  })

  test('T-SP-WEEK-11 leaves the week alone when nothing was republished', () => {
    // Publishing content that did not change answers the version that already exists.
    expect(revisedWeek(week, 'v1', 'v1')).toEqual(week)
    expect(revisedWeek(week, '', 'v9')).toEqual(week)
  })

  test('T-SP-WEEK-12 and never touches a day holding somebody else', () => {
    expect(revisedWeek(week, 'v7', 'v9')).toEqual(week)
  })
})
