import { describe, expect, test } from 'bun:test'

import { createExecutionFlow, type ExecutionTransport } from './execution'

const PLANNED = '019e4000-0000-7000-8000-000000000401'
const EXECUTION = '019e4000-0000-7000-8000-000000000501'

function harness(overrides: Partial<ExecutionTransport> = {}) {
  const sent: { keys: string[]; commands: string[] } = { keys: [], commands: [] }
  let issued = 0

  const transport: ExecutionTransport = {
    readToday: async () => {
      throw new Error('not used')
    },
    readExecution: async () => {
      throw new Error('not used')
    },
    readSummary: async () => {
      throw new Error('not used')
    },
    startAttempt: async (command) => {
      sent.keys.push(command.idempotencyKey)
      return {
        id: EXECUTION,
        attempt_number: 1,
        status: 'in_progress',
        revision_number: 0,
        result_contract: { id: 'contract', version: 1, requested_level: 'detailed' },
      }
    },
    saveResults: async (command) => {
      sent.commands.push(command.commandId)
      return {
        id: EXECUTION,
        status: 'in_progress',
        revision_number: 4,
        segment_count: 0,
        result_count: 1,
      }
    },
    abandon: async () => ({
      id: EXECUTION,
      status: 'abandoned' as const,
      revision_number: 2,
      result_count: 1,
    }),
    finish: async () => ({
      id: EXECUTION,
      status: 'completed',
      validation_status: 'valid',
      revision_number: 5,
      achieved_level: 'detailed',
      is_primary: true,
      contract: { id: 'contract', version: 1 },
    }),
    ...overrides,
  }

  const flow = createExecutionFlow({
    transport,
    newCommand: () => {
      issued += 1
      return { idempotencyKey: `key-${issued}`, commandId: `command-${issued}` }
    },
  })

  return { flow, sent }
}

describe('starting a session', () => {
  test('T-SPC-UNIT-51 answers the session the device named', async () => {
    const { flow } = harness()

    expect(await flow.start(PLANNED, 'America/Bogota')).toBe(EXECUTION)
  })

  test('T-SPC-UNIT-52 retries with the key it already claimed', async () => {
    // Unlike a program choice, a second training session is not something a person
    // can undo: a retry must answer the one already open.
    const used: string[] = []
    const { flow } = harness({
      startAttempt: async (command) => {
        used.push(command.idempotencyKey)
        if (used.length === 1) throw new Error('connection dropped')
        return {
          id: EXECUTION,
          attempt_number: 1,
          status: 'in_progress',
          revision_number: 0,
          result_contract: { id: 'contract', version: 1, requested_level: 'detailed' },
        }
      },
    })

    await expect(flow.start(PLANNED, 'America/Bogota')).rejects.toThrow('connection dropped')
    expect(await flow.start(PLANNED, 'America/Bogota')).toBe(EXECUTION)
    expect(used).toEqual(['key-1', 'key-1'])
  })

  test('T-SPC-UNIT-53 claims a new key once a session actually started', async () => {
    const { flow, sent } = harness()

    await flow.start(PLANNED, 'America/Bogota')
    await flow.start(PLANNED, 'America/Bogota')

    expect(sent.keys).toEqual(['key-1', 'key-2'])
  })

  test('T-SPC-UNIT-54 keeps one key per planned session', async () => {
    const seen: string[] = []
    const { flow } = harness({
      startAttempt: async (command) => {
        seen.push(command.idempotencyKey)
        throw new Error('connection dropped')
      },
    })

    await expect(flow.start(PLANNED, 'America/Bogota')).rejects.toThrow()
    await expect(
      flow.start('019e4000-0000-7000-8000-000000000402', 'America/Bogota'),
    ).rejects.toThrow()
    await expect(flow.start(PLANNED, 'America/Bogota')).rejects.toThrow()

    expect(seen).toEqual(['key-1', 'key-2', 'key-1'])
  })
})

describe('writing what happened', () => {
  test('T-SPC-UNIT-55 answers the revision the server produced', async () => {
    const { flow } = harness()

    expect(await flow.save(EXECUTION, 3, { strength_sets: [] })).toBe(4)
  })

  test('T-SPC-UNIT-56 is a new command every time, not a retry of the last', async () => {
    // A save is the session as it now stands, so replaying the previous one would
    // answer with a state that has since been edited.
    const { flow, sent } = harness()

    await flow.save(EXECUTION, 3, { strength_sets: [] })
    await flow.save(EXECUTION, 4, { strength_sets: [] })

    expect(sent.commands).toEqual(['command-1', 'command-2'])
  })

  test('T-SPC-UNIT-57 carries the revision it believes it is editing', async () => {
    let carried: number | undefined
    const { flow } = harness({
      saveResults: async (_command, _id, revisionNumber) => {
        carried = revisionNumber
        return {
          id: EXECUTION,
          status: 'in_progress',
          revision_number: revisionNumber + 1,
          segment_count: 0,
          result_count: 0,
        }
      },
    })

    await flow.save(EXECUTION, 7, { strength_sets: [] })

    expect(carried).toBe(7)
  })
})

describe('leaving it', () => {
  test('T-SPC-UNIT-61 abandons with its own command, not a replay of the last save', async () => {
    // Leaving is a decision, not a retry: replaying a save would answer with the
    // revision instead of closing the attempt.
    const seen: string[] = []
    const { flow } = harness({
      abandon: async (command) => {
        seen.push(command.commandId)
        return { id: EXECUTION, status: 'abandoned', revision_number: 2, result_count: 1 }
      },
    })

    await flow.save(EXECUTION, 1, { strength_sets: [] })
    await flow.abandon(EXECUTION)

    expect(seen).toEqual(['command-2'])
  })
})

describe('closing it', () => {
  test('T-SPC-UNIT-58 sends the moment it ended', async () => {
    let endedAt: string | undefined
    const { flow } = harness({
      finish: async (_command, _id, ended) => {
        endedAt = ended
        return {
          id: EXECUTION,
          status: 'completed',
          validation_status: 'valid',
          revision_number: 5,
          achieved_level: 'detailed',
          is_primary: true,
          contract: { id: 'contract', version: 1 },
        }
      },
    })

    await flow.finish(EXECUTION)

    expect(endedAt).toBeDefined()
    expect(Number.isNaN(Date.parse(endedAt ?? ''))).toBe(false)
  })
})

describe('the summary after finishing (ADR-036)', () => {
  test('T-SPC-UNIT-162 asks for the session in the zone its weeks are counted in', async () => {
    const asked: string[] = []
    const { flow } = harness({
      readSummary: async (id, timezone) => {
        asked.push(`${id}@${timezone}`)
        throw new Error('stop')
      },
    })

    await flow.readSummary(EXECUTION, 'America/Bogota').catch(() => undefined)

    expect(asked).toEqual([`${EXECUTION}@America/Bogota`])
  })
})
