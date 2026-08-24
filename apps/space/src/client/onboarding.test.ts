/**
 * The idempotency key belongs to the submission, not to the screen or the tap.
 *
 * Its whole job is to survive a lost response: press, request sent, reply never
 * arrives, press again — the second request must carry the same key so the API
 * replays the first result instead of recording a second declaration. Tying it to
 * mounting would break that, because React remounts for reasons unrelated to
 * intent; tying it to each tap would defeat it outright.
 *
 * Changing the answer is a different evaluation and gets a fresh key. The API
 * hashes the body, so reusing a key with different content is refused as a
 * conflict rather than merged — but sending a new one is the honest thing.
 */

import { describe, expect, test } from 'bun:test'

import { createOnboardingFlow, type OnboardingTransport } from './onboarding'

const ATTEMPT = {
  id: '0198e200-0000-7000-8000-000000000009',
  status: 'open' as const,
  eligibility_status: 'pending' as const,
  expires_at: '2026-08-18T00:00:00.000Z',
}
const POLICY = {
  code: 'adult_eligibility',
  version: 1,
  minimum_age: 18,
  jurisdiction: 'CO',
  evidence_kind: 'self_declaration',
} as const
const EVIDENCE = {
  result: 'pass' as const,
  evaluated_at: '2026-08-17T00:00:00.000Z',
  policy: POLICY,
}

const IDENTITY = {
  given_name: 'Ada',
  family_name: 'Lovelace',
  username: 'ada_lovelace',
}

function flowWith(transport: Partial<OnboardingTransport> = {}) {
  const sent: Array<{ idempotencyKey: string; declaredAdult: boolean }> = []
  const declared: Array<{ idempotencyKey: string; username: string }> = []
  const sexes: Array<{ idempotencyKey: string; value: string | null }> = []
  const goals: Array<{ idempotencyKey: string; value: string }> = []
  const focuses: Array<{ idempotencyKey: string; value: string[] }> = []
  const levels: Array<{ idempotencyKey: string; value: string }> = []
  let issued = 0

  const flow = createOnboardingFlow({
    transport: {
      startAttempt: async () => ATTEMPT,
      recordEligibility: async (command, _attemptId, declaredAdult) => {
        sent.push({ idempotencyKey: command.idempotencyKey, declaredAdult })
        return EVIDENCE
      },
      createFitnessId: async (command, _attemptId, identity) => {
        declared.push({ idempotencyKey: command.idempotencyKey, username: identity.username })
        return identity
      },
      declareBiologicalSex: async (command, _attemptId, biologicalSex) => {
        sexes.push({ idempotencyKey: command.idempotencyKey, value: biologicalSex })
        return biologicalSex
      },
      declareTrainingGoal: async (command, goal) => {
        goals.push({ idempotencyKey: command.idempotencyKey, value: goal })
        return {
          attribute_code: 'primary_training_goal' as const,
          value_text: goal,
          superseded_claim_id: null,
        }
      },
      declareFocusAreas: async (command, areas) => {
        focuses.push({ idempotencyKey: command.idempotencyKey, value: [...areas] })
        return areas
      },
      declareTrainingExperience: async (command, level) => {
        levels.push({ idempotencyKey: command.idempotencyKey, value: level })
        return {
          attribute_code: 'training_experience' as const,
          value_text: level,
          superseded_claim_id: null,
        }
      },
      readCurrent: async () => ({
        attempt: ATTEMPT,
        answers: {
          identity: { answered: false, value: null },
          biological_sex: { answered: false, value: null },
          primary_training_goal: { answered: false, value: null },
          focus_areas: { answered: false, value: [] },
          training_experience: { answered: false, value: null },
        },
      }),
      ...transport,
    },
    newCommand: () => {
      issued += 1
      return { idempotencyKey: `key_${issued}`, commandId: `command_${issued}` }
    },
  })

  return { flow, sent, declared, sexes, goals, focuses, levels }
}

describe('declareAdult', () => {
  test('reuses the key when a failed submission is retried', async () => {
    let attempts = 0
    const { flow, sent } = flowWith({
      recordEligibility: async (command, _attemptId, declaredAdult) => {
        attempts += 1
        sent.push({ idempotencyKey: command.idempotencyKey, declaredAdult })
        if (attempts === 1) throw new Error('network')
        return EVIDENCE
      },
    })

    await expect(flow.declareAdult(true)).rejects.toThrow()
    await flow.declareAdult(true)

    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey as string)
  })

  test('issues a fresh key when the answer changes', async () => {
    const { flow, sent } = flowWith({
      recordEligibility: async (command, _attemptId, declaredAdult) => {
        sent.push({ idempotencyKey: command.idempotencyKey, declaredAdult })
        throw new Error('network')
      },
    })

    await expect(flow.declareAdult(true)).rejects.toThrow()
    await expect(flow.declareAdult(false)).rejects.toThrow()

    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey as string)
  })

  test('discards the key once the declaration lands, so a later one is its own', async () => {
    const { flow, sent } = flowWith()

    await flow.declareAdult(true)
    await flow.declareAdult(true)

    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey as string)
  })

  test('opens the attempt once and reuses it across submissions', async () => {
    let starts = 0
    const { flow } = flowWith({
      startAttempt: async () => {
        starts += 1
        return ATTEMPT
      },
      recordEligibility: async () => {
        throw new Error('network')
      },
    })

    await expect(flow.declareAdult(true)).rejects.toThrow()
    await expect(flow.declareAdult(true)).rejects.toThrow()

    expect(starts).toBe(1)
  })

  test('returns the evaluation so the screen can refuse to advance on a fail', async () => {
    const { flow } = flowWith({
      recordEligibility: async () => ({
        result: 'fail' as const,
        evaluated_at: EVIDENCE.evaluated_at,
        policy: POLICY,
      }),
    })

    await expect(flow.declareAdult(true)).resolves.toEqual({
      result: 'fail',
      evaluated_at: EVIDENCE.evaluated_at,
      policy: POLICY,
    })
  })
})

describe('createFitnessId', () => {
  test('reuses the key when a failed submission is retried', async () => {
    const keys: string[] = []
    let firstCall = true
    const { flow } = flowWith({
      createFitnessId: async (command, _attemptId, identity) => {
        keys.push(command.idempotencyKey)
        if (firstCall) {
          firstCall = false
          throw new Error('network')
        }
        return identity
      },
    })

    await expect(flow.createFitnessId(IDENTITY)).rejects.toThrow('network')
    await flow.createFitnessId(IDENTITY)

    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  test('issues a fresh key when any part of the answer changes', async () => {
    const { flow, declared } = flowWith()

    await flow.createFitnessId(IDENTITY)
    await flow.createFitnessId({ ...IDENTITY, username: 'ada_byron' })

    expect(declared[1]?.idempotencyKey).not.toBe(declared[0]?.idempotencyKey)
  })

  test('discards the key once the identity lands, so a later one is its own', async () => {
    const { flow, declared } = flowWith()

    await flow.createFitnessId(IDENTITY)
    await flow.createFitnessId(IDENTITY)

    expect(declared[1]?.idempotencyKey).not.toBe(declared[0]?.idempotencyKey)
  })

  test('opens the attempt once and reuses it across steps', async () => {
    let starts = 0
    const { flow } = flowWith({
      startAttempt: async () => {
        starts += 1
        return ATTEMPT
      },
    })

    await flow.declareAdult(true)
    await flow.createFitnessId(IDENTITY)

    expect(starts).toBe(1)
  })

  test('surfaces a taken handle as itself, not as a failure to reach the API', async () => {
    // Shaped like ApiError rather than imported: `./index` pulls React Native
    // into the runner, and the flow only ever propagates what it is given.
    const { flow } = flowWith({
      createFitnessId: async () => {
        throw Object.assign(new Error('conflict'), { failure: 'conflict' })
      },
    })

    await expect(flow.createFitnessId(IDENTITY)).rejects.toMatchObject({ failure: 'conflict' })
  })
})

describe('resume', () => {
  test('returns what the server already holds', async () => {
    const { flow } = flowWith({
      readCurrent: async () => ({
        attempt: ATTEMPT,
        answers: {
          identity: { answered: true, value: IDENTITY },
          biological_sex: { answered: false, value: null },
          primary_training_goal: { answered: false, value: null },
          focus_areas: { answered: false, value: [] },
          training_experience: { answered: false, value: null },
        },
      }),
    })

    expect(await flow.resume()).toEqual({
      attempt: ATTEMPT,
      answers: {
        identity: { answered: true, value: IDENTITY },
        biological_sex: { answered: false, value: null },
        primary_training_goal: { answered: false, value: null },
        focus_areas: { answered: false, value: [] },
        training_experience: { answered: false, value: null },
      },
    })
  })

  test('adopts the open attempt instead of starting a second one', async () => {
    let starts = 0
    const { flow } = flowWith({
      startAttempt: async () => {
        starts += 1
        return ATTEMPT
      },
      readCurrent: async () => ({
        attempt: ATTEMPT,
        answers: {
          identity: { answered: false, value: null },
          biological_sex: { answered: false, value: null },
          primary_training_goal: { answered: false, value: null },
          focus_areas: { answered: false, value: [] },
          training_experience: { answered: false, value: null },
        },
      }),
    })

    await flow.resume()
    await flow.createFitnessId(IDENTITY)

    expect(starts).toBe(0)
  })

  test('leaves the flow able to start when nothing was open', async () => {
    let starts = 0
    const { flow } = flowWith({
      startAttempt: async () => {
        starts += 1
        return ATTEMPT
      },
      readCurrent: async () => ({
        attempt: null,
        answers: {
          identity: { answered: false, value: null },
          biological_sex: { answered: false, value: null },
          primary_training_goal: { answered: false, value: null },
          focus_areas: { answered: false, value: [] },
          training_experience: { answered: false, value: null },
        },
      }),
    })

    await flow.resume()
    await flow.createFitnessId(IDENTITY)

    expect(starts).toBe(1)
  })
})

describe('declareBiologicalSex', () => {
  test('sends the value the person chose', async () => {
    const { flow, sexes } = flowWith()

    await expect(flow.declareBiologicalSex('female')).resolves.toBe('female')
    expect(sexes.map((entry) => entry.value)).toEqual(['female'])
  })

  test('reuses the key while the same answer keeps failing', async () => {
    let attempts = 0
    const keys: string[] = []
    const { flow } = flowWith({
      declareBiologicalSex: async (command, _attemptId, value) => {
        keys.push(command.idempotencyKey)
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return value
      },
    })

    await expect(flow.declareBiologicalSex('male')).rejects.toThrow('network')
    await expect(flow.declareBiologicalSex('male')).resolves.toBe('male')

    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  test('starts a new submission when the answer changes', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareBiologicalSex: async (command) => {
        keys.push(command.idempotencyKey)
        throw new Error('network')
      },
    })

    await expect(flow.declareBiologicalSex('male')).rejects.toThrow('network')
    await expect(flow.declareBiologicalSex('female')).rejects.toThrow('network')

    // A corrected answer must not reuse a key the server already hashed against
    // the previous body: that would come back as a conflict.
    expect(keys[0]).not.toBe(keys[1])
  })

  test('discards the key once it lands, so a later change is a new command', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareBiologicalSex: async (command, _attemptId, value) => {
        keys.push(command.idempotencyKey)
        return value
      },
    })

    await flow.declareBiologicalSex('male')
    await flow.declareBiologicalSex('male')

    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('declareTrainingGoal', () => {
  test('sends the goal the person chose, without opening an attempt for it', async () => {
    const { flow, goals } = flowWith({
      startAttempt: async () => {
        throw new Error('the goal must not need an attempt')
      },
    })

    const claim = await flow.declareTrainingGoal('build_muscle')

    expect(claim.value_text).toBe('build_muscle')
    expect(goals.map((entry) => entry.value)).toEqual(['build_muscle'])
  })

  test('reuses the key while the same answer keeps failing', async () => {
    let attempts = 0
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingGoal: async (command, goal) => {
        keys.push(command.idempotencyKey)
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return {
          attribute_code: 'primary_training_goal' as const,
          value_text: goal,
          superseded_claim_id: null,
        }
      },
    })

    await expect(flow.declareTrainingGoal('get_fit')).rejects.toThrow('network')
    await expect(flow.declareTrainingGoal('get_fit')).resolves.toMatchObject({
      value_text: 'get_fit',
    })

    // One lost response must replay, not record a second goal.
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  test('starts a new submission when the answer changes', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingGoal: async (command) => {
        keys.push(command.idempotencyKey)
        throw new Error('network')
      },
    })

    await expect(flow.declareTrainingGoal('lose_weight')).rejects.toThrow('network')
    await expect(flow.declareTrainingGoal('maintain')).rejects.toThrow('network')

    // The server hashes the body against the key, so reusing it with a different
    // goal comes back as a conflict rather than a correction.
    expect(keys[0]).not.toBe(keys[1])
  })

  test('discards the key once it lands, so a later correction is its own command', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingGoal: async (command, goal) => {
        keys.push(command.idempotencyKey)
        return {
          attribute_code: 'primary_training_goal' as const,
          value_text: goal,
          superseded_claim_id: null,
        }
      },
    })

    await flow.declareTrainingGoal('run_a_race')
    await flow.declareTrainingGoal('run_a_race')

    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('declareFocusAreas', () => {
  test('sends the whole set, and needs no attempt for it', async () => {
    const { flow, focuses } = flowWith({
      startAttempt: async () => {
        throw new Error('the emphasis must not need an attempt')
      },
    })

    const declared = await flow.declareFocusAreas(['chest', 'arms'])

    expect(declared).toEqual(['chest', 'arms'])
    expect(focuses.map((entry) => entry.value)).toEqual([['chest', 'arms']])
  })

  test('reuses the key while the same emphasis keeps failing', async () => {
    let attempts = 0
    const keys: string[] = []
    const { flow } = flowWith({
      declareFocusAreas: async (command, areas) => {
        keys.push(command.idempotencyKey)
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return areas
      },
    })

    await expect(flow.declareFocusAreas(['legs'])).rejects.toThrow('network')
    await expect(flow.declareFocusAreas(['legs'])).resolves.toEqual(['legs'])

    // One lost response must replay rather than declare the emphasis twice.
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  test('treats the same set in another order as the same submission', async () => {
    let attempts = 0
    const keys: string[] = []
    const { flow } = flowWith({
      declareFocusAreas: async (command, areas) => {
        keys.push(command.idempotencyKey)
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return areas
      },
    })

    await expect(flow.declareFocusAreas(['chest', 'legs'])).rejects.toThrow('network')
    await expect(flow.declareFocusAreas(['legs', 'chest'])).resolves.toBeDefined()

    // Tapping the same two zones in the other order is not a different answer, and
    // a new key would turn a retry into a second command.
    expect(keys[0]).toBe(keys[1])
  })

  test('starts a new submission when a zone changes', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareFocusAreas: async (command) => {
        keys.push(command.idempotencyKey)
        throw new Error('network')
      },
    })

    await expect(flow.declareFocusAreas(['chest'])).rejects.toThrow('network')
    await expect(flow.declareFocusAreas(['chest', 'abs'])).rejects.toThrow('network')

    // The server hashes the body against the key, so the same key with another set
    // comes back as a conflict rather than as a correction.
    expect(keys[0]).not.toBe(keys[1])
  })

  test('discards the key once it lands, so editing later is its own command', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareFocusAreas: async (command, areas) => {
        keys.push(command.idempotencyKey)
        return areas
      },
    })

    await flow.declareFocusAreas(['whole_body'])
    await flow.declareFocusAreas(['whole_body'])

    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('declareTrainingExperience', () => {
  test('sends the level chosen, without opening an attempt for it', async () => {
    const { flow, levels } = flowWith({
      startAttempt: async () => {
        throw new Error('the level must not need an attempt')
      },
    })

    const claim = await flow.declareTrainingExperience('some_practice')

    expect(claim.value_text).toBe('some_practice')
    expect(levels.map((entry) => entry.value)).toEqual(['some_practice'])
  })

  test('reuses the key while the same level keeps failing', async () => {
    let attempts = 0
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingExperience: async (command, level) => {
        keys.push(command.idempotencyKey)
        attempts += 1
        if (attempts === 1) throw new Error('network')
        return {
          attribute_code: 'training_experience' as const,
          value_text: level,
          superseded_claim_id: null,
        }
      },
    })

    await expect(flow.declareTrainingExperience('starting')).rejects.toThrow('network')
    await expect(flow.declareTrainingExperience('starting')).resolves.toMatchObject({
      value_text: 'starting',
    })

    // One lost response must replay, not record a second level.
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  test('starts a new submission when the level changes', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingExperience: async (command) => {
        keys.push(command.idempotencyKey)
        throw new Error('network')
      },
    })

    await expect(flow.declareTrainingExperience('starting')).rejects.toThrow('network')
    await expect(flow.declareTrainingExperience('experienced')).rejects.toThrow('network')

    // The server hashes the body against the key, so reusing it with another level
    // comes back as a conflict rather than as a requalification.
    expect(keys[0]).not.toBe(keys[1])
  })

  test('discards the key once it lands, so requalifying later is its own command', async () => {
    const keys: string[] = []
    const { flow } = flowWith({
      declareTrainingExperience: async (command, level) => {
        keys.push(command.idempotencyKey)
        return {
          attribute_code: 'training_experience' as const,
          value_text: level,
          superseded_claim_id: null,
        }
      },
    })

    await flow.declareTrainingExperience('experienced')
    await flow.declareTrainingExperience('experienced')

    expect(keys[0]).not.toBe(keys[1])
  })
})
