/**
 * Draft content reaches PostgreSQL as a jsonb parameter. A pre-serialized string
 * binds as a JSON string rather than an object, and the content functions then
 * reject every draft as an invalid shape, so the binding is asserted here.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type postgres from 'postgres'

import { setDatabase } from '../../../platform/db/index.js'
import { createPlanningDatabase } from './index.js'

interface CapturedQuery {
  values: unknown[]
}

const JSON_PARAMETER = Symbol('json-parameter')

function recordingDatabase(captured: CapturedQuery[]): ReturnType<typeof postgres> {
  const client = Object.assign(
    (_strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ values })
      return Promise.resolve([{ result: {}, replayed: false }])
    },
    {
      begin: (operation: (transaction: unknown) => Promise<unknown>) => operation(client),
      json: (value: unknown) => ({ [JSON_PARAMETER]: value }),
      end: () => Promise.resolve(),
    },
  )
  return client as unknown as ReturnType<typeof postgres>
}

const PERSON_ID = '019d0000-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '019d0000-0000-7000-8000-000000000101'
const TEMPLATE_ID = '019d0000-0000-7000-8000-000000000401'
const PROGRAM_ID = '019d0000-0000-7000-8000-000000000501'
const ETAG = `"sha256:${'A'.repeat(43)}"`

const command = {
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
  commandId: '019d0000-0000-7000-8000-000000000301',
  requestHash: Buffer.alloc(32),
}

afterEach(async () => {
  await setDatabase(undefined)
})

describe('Planning draft content binding', () => {
  test('T-PLN-IDEM-20 a session template draft binds its content as a structured jsonb value', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))
    const content = {
      title: 'Strength A',
      activity_type_id: '019c0000-0000-7000-8000-000000000011',
      steps: [{ position: 1, target: { family: 'strength' as const, target_sets: 3 } }],
    }
    await createPlanningDatabase().replaceSessionTemplateDraft({
      personId: PERSON_ID,
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
      expectedEtag: ETAG,
      content,
      ...command,
    })
    const bound = captured.at(-1)?.values[4]
    expect(typeof bound).not.toBe('string')
    expect(bound).toEqual({ [JSON_PARAMETER]: content })
  })

  test('T-PLN-IDEM-21 a program draft binds its content as a structured jsonb value', async () => {
    const captured: CapturedQuery[] = []
    await setDatabase(recordingDatabase(captured))
    const content = { title: 'Program A', notes: null, sessions: [] }
    await createPlanningDatabase().replaceProgramDraft({
      personId: PERSON_ID,
      organizationId: ORGANIZATION_ID,
      programId: PROGRAM_ID,
      expectedEtag: ETAG,
      content,
      ...command,
    })
    const bound = captured.at(-1)?.values[4]
    expect(typeof bound).not.toBe('string')
    expect(bound).toEqual({ [JSON_PARAMETER]: content })
  })
})
