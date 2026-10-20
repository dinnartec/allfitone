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
    listHistory: async () => {
      throw new Error('not used')
    },
    readHistoryMonth: async () => {
      throw new Error('not used')
    },
    readFinished: async () => {
      throw new Error('not used')
    },
    readAnnulmentPreview: async () => {
      throw new Error('not used')
    },
    revise: async (command, _id, revisionNumber) => {
      sent.commands.push(command.commandId)
      return { id: EXECUTION, revision_number: revisionNumber + 1, result_count: 1 }
    },
    annul: async (command) => {
      sent.keys.push(command.idempotencyKey)
      return { id: EXECUTION, annulled_at: '2026-10-01T12:00:00.000Z' }
    },
    repeat: async (command) => {
      sent.keys.push(command.idempotencyKey)
      return {
        id: 'repeated',
        attempt_number: 2,
        status: 'in_progress' as const,
        revision_number: 0,
      }
    },
    startFreeSession: async (command) => {
      sent.keys.push(command.idempotencyKey)
      return {
        id: command.commandId,
        status: 'in_progress',
        revision_number: 0,
        result_contract: { id: 'contract', version: 1, requested_level: 'detailed' },
      }
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

describe('starting a free session', () => {
  test('T-SPC-UNIT-299 starts a strength session under the id the device chose', async () => {
    let body: Parameters<ExecutionTransport['startFreeSession']>[1] | undefined
    const { flow } = harness({
      startFreeSession: async (command, start) => {
        body = start
        return {
          id: command.commandId,
          status: 'in_progress',
          revision_number: 0,
          result_contract: { id: 'contract', version: 1, requested_level: 'detailed' },
        }
      },
    })

    expect(await flow.startFree('America/Bogota')).toBe('command-1')
    expect(body?.discipline_code).toBe('strength')
    expect(body?.timezone).toBe('America/Bogota')
  })

  test('T-SPC-UNIT-300 a retry sends the same command and the same start time', async () => {
    // The body is hashed with the key: a new `started_at` on the retry would be a
    // different request under the same key, and the server would refuse it.
    const sentStarts: string[] = []
    const used: string[] = []
    const { flow } = harness({
      startFreeSession: async (command, start) => {
        used.push(command.idempotencyKey)
        sentStarts.push(start.started_at)
        if (used.length === 1) throw new Error('connection dropped')
        return {
          id: command.commandId,
          status: 'in_progress',
          revision_number: 0,
          result_contract: { id: 'contract', version: 1, requested_level: 'detailed' },
        }
      },
    })

    await expect(flow.startFree('America/Bogota')).rejects.toThrow('connection dropped')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await flow.startFree('America/Bogota')).toBe('command-1')
    expect(used).toEqual(['key-1', 'key-1'])
    expect(sentStarts[1]).toBe(sentStarts[0])
  })

  test('T-SPC-UNIT-301 once one started, the next free session claims a new key', async () => {
    const { flow, sent } = harness()

    await flow.startFree('America/Bogota')
    await flow.startFree('America/Bogota')

    expect(sent.keys).toEqual(['key-1', 'key-2'])
  })
})

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

describe('a finished session (ADR-038)', () => {
  const revision = {
    started_at: '2026-09-29T23:02:00.000Z',
    ended_at: '2026-09-29T23:50:00.000Z',
    strength_sets: [{ order: 1 }],
  }

  test('T-SPC-UNIT-189 a correction is a new command under the revision it read', async () => {
    const { flow, sent } = harness()

    expect(await flow.revise(EXECUTION, 4, revision)).toBe(5)
    await flow.revise(EXECUTION, 5, revision)

    expect(sent.commands).toEqual(['command-1', 'command-2'])
  })

  test('T-SPC-UNIT-190 an annulment retried over a dropped connection keeps its key', async () => {
    let calls = 0
    const { flow, sent } = harness({
      annul: async (command) => {
        sent.keys.push(command.idempotencyKey)
        calls += 1
        if (calls === 1) throw new Error('offline')
        return { id: EXECUTION, annulled_at: '2026-10-01T12:00:00.000Z' }
      },
    })

    await flow.annul(EXECUTION).catch(() => undefined)
    await flow.annul(EXECUTION)

    expect(sent.keys).toEqual(['key-1', 'key-1'])
  })

  test('T-SPC-UNIT-191 a repeat keeps its key until a session opens, then claims a new one', async () => {
    let calls = 0
    const starts: { started_at: string; timezone: string }[] = []
    const { flow, sent } = harness({
      repeat: async (command, _source, start) => {
        sent.keys.push(command.idempotencyKey)
        starts.push(start)
        calls += 1
        if (calls === 1) throw new Error('offline')
        return { id: 'repeated', attempt_number: 2, status: 'in_progress', revision_number: 0 }
      },
    })

    await flow.repeat(EXECUTION, 'America/Bogota').catch(() => undefined)
    expect(await flow.repeat(EXECUTION, 'America/Bogota')).toBe('repeated')
    await flow.repeat(EXECUTION, 'America/Bogota')

    expect(sent.keys).toEqual(['key-1', 'key-1', 'key-2'])
    expect(starts[0]?.timezone).toBe('America/Bogota')
  })
})
