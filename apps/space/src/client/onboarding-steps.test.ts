import { describe, expect, test } from 'bun:test'

import {
  ELIGIBILITY_GATE_ROUTE,
  guardStep,
  lastRevisitableStep,
  ONBOARDING_STEPS,
  resolveOnboardingRoute,
  stepPosition,
  type OnboardingProgress,
} from './onboarding-steps'

const PASSED = { eligibility_status: 'pass' as const }
const IDENTITY = { given_name: 'Ada', family_name: 'Lovelace', username: 'ada_lovelace' }

describe('resolveOnboardingRoute', () => {
  test('sends a session with nothing read to the first step', () => {
    expect(resolveOnboardingRoute(null)).toBe('/onboarding/age')
  })

  test('keeps a pending declaration on the first step', () => {
    expect(resolveOnboardingRoute({ attempt: { eligibility_status: 'pending' } })).toBe(
      '/onboarding/age',
    )
  })

  test('never walks past a refusal, because a fail is not eligibility', () => {
    expect(resolveOnboardingRoute({ attempt: { eligibility_status: 'fail' } })).toBe(
      '/onboarding/age',
    )
  })

  test('asks for the name once the age is behind', () => {
    expect(resolveOnboardingRoute({ attempt: PASSED })).toBe('/onboarding/identity')
  })

  test('asks for the biological sex once the Fitness ID exists', () => {
    expect(resolveOnboardingRoute({ attempt: PASSED, identity: IDENTITY })).toBe('/onboarding/sex')
  })

  test('does not send a person who declined back to the same screen', () => {
    // The refusal records no value, so deciding from the value alone would ask
    // again on every cold start and the onboarding could never advance.
    const declined: OnboardingProgress = {
      attempt: PASSED,
      identity: IDENTITY,
      biological_sex_answered: true,
    }

    expect(resolveOnboardingRoute(declined)).toBe('/onboarding/continues')
  })
})

describe('stepPosition', () => {
  test('starts counting at the name, because the age gate is not a step', () => {
    expect(stepPosition('/onboarding/identity').position).toBe(1)
    expect(stepPosition('/onboarding/sex').position).toBe(2)
  })

  test('reports the same total as the declared order, so the bar cannot drift', () => {
    expect(stepPosition('/onboarding/identity').total).toBe(ONBOARDING_STEPS.length)
  })

  test('has nothing behind the first step, which is why it carries no back arrow', () => {
    expect(stepPosition('/onboarding/identity').previous).toBeNull()
    expect(stepPosition('/onboarding/identity').completed).toBe(0)
  })

  test('points back at the nearest step that may be changed', () => {
    expect(stepPosition('/onboarding/sex').previous).toBe('/onboarding/identity')
  })

  test('never offers to go back to the adult declaration', () => {
    // It is the evidence that gated creating the person, and it is not even a step.
    // The type already forbids the comparison, which is the stronger guarantee;
    // this keeps it checked at runtime too.
    expect(ONBOARDING_STEPS.map((step) => String(step.route))).not.toContain(ELIGIBILITY_GATE_ROUTE)
  })

  test('agrees with the router about the order', () => {
    // Walking the declared order must produce exactly the routes the resume
    // decision hands out, or the bar and the navigation disagree.
    const walked = [
      resolveOnboardingRoute({ attempt: PASSED }),
      resolveOnboardingRoute({ attempt: PASSED, identity: IDENTITY }),
    ]

    expect(walked).toEqual(ONBOARDING_STEPS.map((step) => step.route))
    // And before the gate is passed, no step is offered at all.
    expect(resolveOnboardingRoute({ attempt: null })).toBe(ELIGIBILITY_GATE_ROUTE)
  })
})

describe('guardStep', () => {
  const ANSWERED: OnboardingProgress = {
    attempt: PASSED,
    identity: IDENTITY,
    biological_sex_answered: true,
  }

  test('lets a step already answered be opened, because that is editing', () => {
    expect(guardStep('/onboarding/identity', ANSWERED)).toBeNull()
    expect(guardStep('/onboarding/sex', ANSWERED)).toBeNull()
  })

  test('lets the current step through', () => {
    expect(guardStep('/onboarding/sex', { attempt: PASSED, identity: IDENTITY })).toBeNull()
  })

  test('refuses to let a missing prerequisite be skipped', () => {
    // Opening the sex step with no Fitness ID has nowhere to write: the person is
    // the subject of the answer and does not exist yet.
    expect(guardStep('/onboarding/sex', { attempt: PASSED })).toBe('/onboarding/identity')
    expect(guardStep('/onboarding/identity', { attempt: null })).toBe(ELIGIBILITY_GATE_ROUTE)
  })
})

describe('lastRevisitableStep', () => {
  test('is the last declared step a person may change', () => {
    expect(lastRevisitableStep()).toBe('/onboarding/sex')
  })

  test('follows the declared order rather than a name written once', () => {
    const revisitable = ONBOARDING_STEPS.filter((step) => step.revisitable).map(
      (step) => step.route,
    )

    expect(revisitable).not.toHaveLength(0)
    expect(lastRevisitableStep()).toBe(revisitable[revisitable.length - 1] ?? null)
  })
})
