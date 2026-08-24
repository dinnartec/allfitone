import { describe, expect, test } from 'bun:test'

import { routeAfterAuthentication } from './resume-route'

const PASSED = { eligibility_status: 'pass' as const }

const answers = (
  ...steps: Array<'identity' | 'biological_sex' | 'primary_training_goal' | 'focus_areas'>
) => ({
  identity: { answered: steps.includes('identity') },
  biological_sex: { answered: steps.includes('biological_sex') },
  primary_training_goal: { answered: steps.includes('primary_training_goal') },
  focus_areas: { answered: steps.includes('focus_areas') },
})

describe('routeAfterAuthentication', () => {
  test('resumes where the person left off instead of restarting', async () => {
    // The defect this replaces: signing in always went to the adult declaration,
    // which is also the one step that cannot be changed.
    await expect(
      routeAfterAuthentication(async () => ({ attempt: PASSED, answers: answers('identity') })),
    ).resolves.toBe('/onboarding/sex')
  })

  test('sends somebody with nothing answered to the gate', async () => {
    await expect(routeAfterAuthentication(async () => ({ attempt: null }))).resolves.toBe(
      '/onboarding/age',
    )
  })

  test('does not send a finished onboarding to the sign-up screen', async () => {
    await expect(
      routeAfterAuthentication(async () => ({
        attempt: PASSED,
        answers: answers('identity', 'biological_sex', 'primary_training_goal', 'focus_areas'),
      })),
    ).resolves.toBe('/onboarding/continues')
  })

  test('lands on the gate when the answer cannot be read, rather than guessing', async () => {
    await expect(
      routeAfterAuthentication(() => Promise.reject(new Error('network'))),
    ).resolves.toBe('/onboarding/age')
  })
})
