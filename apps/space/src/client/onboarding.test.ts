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
      readCurrent: async () => ({ attempt: ATTEMPT, identity: null }),
      ...transport,
    },
    newCommand: () => {
      issued += 1
      return { idempotencyKey: `key_${issued}`, commandId: `command_${issued}` }
    },
  })

  return { flow, sent, declared }
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
      readCurrent: async () => ({ attempt: ATTEMPT, identity: IDENTITY }),
    })

    expect(await flow.resume()).toEqual({ attempt: ATTEMPT, identity: IDENTITY })
  })

  test('adopts the open attempt instead of starting a second one', async () => {
    let starts = 0
    const { flow } = flowWith({
      startAttempt: async () => {
        starts += 1
        return ATTEMPT
      },
      readCurrent: async () => ({ attempt: ATTEMPT, identity: null }),
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
      readCurrent: async () => ({ attempt: null, identity: null }),
    })

    await flow.resume()
    await flow.createFitnessId(IDENTITY)

    expect(starts).toBe(1)
  })
})
