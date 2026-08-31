import { describe, expect, test } from 'bun:test'

import { createProgramFlow, type ProgramAssignment, type ProgramTransport } from './programs'

const VERSION_ID = '019f3000-0000-7000-8000-000000000006'
const OTHER_VERSION_ID = '019f3000-0000-7000-8000-000000000005'

const assignment: ProgramAssignment = {
  assignment_id: '019f9000-0000-7000-8000-000000000011',
  program_version_id: VERSION_ID,
  title: 'Empuje · tirón · pierna',
  starts_on: '2026-08-31',
  timezone: 'America/Bogota',
  sessions_planned: 60,
}

function harness(overrides?: Partial<ProgramTransport>) {
  const commands: string[] = []
  const chosen: Array<{ key: string; versionId: string }> = []
  let issued = 0

  const transport: ProgramTransport = {
    readWeekPlan: async () => {
      throw new Error('not used in this test')
    },
    readMyPrograms: async () => {
      throw new Error('not used in this test')
    },
    reorder: async () => {
      throw new Error('not used in this test')
    },
    readDetail: async () => {
      throw new Error('not used in this test')
    },
    readCatalogue: async () => ({
      profile: {
        given_name: 'Ada',
        primary_training_goal: null,
        training_experience: null,
        biological_sex: null,
        focus_areas: [],
      },
      programs: [],
      current_assignment: null,
    }),
    choose: async (command, choice) => {
      chosen.push({ key: command.idempotencyKey, versionId: choice.program_version_id })
      return { ...assignment, program_version_id: choice.program_version_id }
    },
    ...overrides,
  }

  const flow = createProgramFlow({
    transport,
    newCommand: () => {
      issued += 1
      const key = `key-${issued}`
      commands.push(key)
      return { idempotencyKey: key, commandId: `command-${issued}` }
    },
  })

  return { flow, chosen, commands }
}

describe('choose', () => {
  test('answers the assignment', async () => {
    const { flow } = harness()

    await expect(
      flow.choose({ program_version_id: VERSION_ID, timezone: 'America/Bogota' }),
    ).resolves.toEqual(assignment)
  })

  test('holds the key across retries of the same card', async () => {
    // A second key would be a second command, and one press must not leave somebody
    // with two calendars.
    let attempts = 0
    const { flow, chosen } = harness({
      choose: async (command, choice) => {
        attempts += 1
        if (attempts === 1) throw new Error('lost response')
        return { ...assignment, program_version_id: choice.program_version_id, ...{} }
      },
    })

    const choice = { program_version_id: VERSION_ID, timezone: 'America/Bogota' }
    await expect(flow.choose(choice)).rejects.toThrow('lost response')
    await flow.choose(choice)

    expect(attempts).toBe(2)
    void chosen
  })

  test('gives a different card its own key, because it is a different intention', async () => {
    const { flow, chosen } = harness()

    await flow.choose({ program_version_id: VERSION_ID, timezone: 'America/Bogota' })
    await flow.choose({ program_version_id: OTHER_VERSION_ID, timezone: 'America/Bogota' })

    expect(chosen).toHaveLength(2)
    expect(chosen[0]?.key).not.toBe(chosen[1]?.key)
  })

  test('releases the key once the choice succeeded', async () => {
    const { flow, chosen } = harness()
    const choice = { program_version_id: VERSION_ID, timezone: 'America/Bogota' }

    await flow.choose(choice)
    await flow.choose(choice)

    // Choosing the same program again after it succeeded is a new intention, not a
    // retry of the old one.
    expect(chosen[0]?.key).not.toBe(chosen[1]?.key)
  })
})
