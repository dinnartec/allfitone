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

function flowWith(transport: Partial<OnboardingTransport> = {}) {
  const sent: Array<{ idempotencyKey: string; declaredAdult: boolean }> = []
  let issued = 0

  const flow = createOnboardingFlow({
    transport: {
      startAttempt: async () => ATTEMPT,
      recordEligibility: async (command, _attemptId, declaredAdult) => {
        sent.push({ idempotencyKey: command.idempotencyKey, declaredAdult })
        return EVIDENCE
      },
      ...transport,
    },
    newCommand: () => {
      issued += 1
      return { idempotencyKey: `key_${issued}`, commandId: `command_${issued}` }
    },
  })

  return { flow, sent }
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
