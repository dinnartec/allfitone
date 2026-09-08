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
  createContentFlow,
  expandBaseWeek,
  MissingEtagError,
  summarizeBaseWeek,
  type ContentTransport,
} from './content'

const TEMPLATE_ID = '019f9000-0000-7000-8000-000000000041'
const PROGRAM_ID = '019f9000-0000-7000-8000-000000000051'
const VERSION_ID = '019f9000-0000-7000-8000-000000000061'

function harness(overrides: Partial<ContentTransport> = {}) {
  const sent: { command: string; etag?: string }[] = []
  let issued = 0
  const command = () => ({
    idempotencyKey: `key-${(issued += 1)}`,
    commandId: `command-${issued}`,
  })
  const draft = (etag: string) => ({ etag }) as never

  const transport: ContentTransport = {
    searchMovements: async () => [],
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
    createProgram: async (headers) => {
      sent.push({ command: headers.idempotencyKey })
      return { id: PROGRAM_ID, draft: { etag: 'program-etag-1' } } as never
    },
    saveProgramDraft: async (headers, _id, etag) => {
      sent.push({ command: headers.idempotencyKey, etag })
      return draft('program-etag-2')
    },
    publishProgram: async (headers, _id, etag) => {
      sent.push({ command: headers.idempotencyKey, etag })
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
    await flow.publishProgram(PROGRAM_ID)

    expect(sent.at(-1)?.etag).toBe('program-etag-2')
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
