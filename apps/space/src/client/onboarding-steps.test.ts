import { describe, expect, test } from 'bun:test'

import {
  ELIGIBILITY_GATE_ROUTE,
  FIRST_STEP_ROUTE,
  ONBOARDING_STEPS,
  guardStep,
  lastRevisitableStep,
  nextRouteAfter,
  resolveOnboardingRoute,
  stepPosition,
  type OnboardingProgress,
} from './onboarding-steps'

const PASSED = { eligibility_status: 'pass' as const }

/** Every step, so a test can say which ones are behind it. */
const answers = (
  ...steps: Array<
    'identity' | 'biological_sex' | 'primary_training_goal' | 'focus_areas' | 'training_experience'
  >
) => ({
  identity: { answered: steps.includes('identity') },
  biological_sex: { answered: steps.includes('biological_sex') },
  primary_training_goal: { answered: steps.includes('primary_training_goal') },
  focus_areas: { answered: steps.includes('focus_areas') },
  training_experience: { answered: steps.includes('training_experience') },
})

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
    expect(resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity') })).toBe(
      '/onboarding/sex',
    )
  })

  test('does not send a person who declined back to the same screen', () => {
    // The refusal records no value, so deciding from the value alone would ask
    // again on every cold start and the onboarding could never advance.
    const declined: OnboardingProgress = {
      attempt: PASSED,
      answers: answers('identity', 'biological_sex'),
    }

    expect(resolveOnboardingRoute(declined)).toBe('/onboarding/goal')
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
      resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity') }),
      resolveOnboardingRoute({ attempt: PASSED, answers: answers('identity', 'biological_sex') }),
      resolveOnboardingRoute({
        attempt: PASSED,
        answers: answers('identity', 'biological_sex', 'primary_training_goal'),
      }),
      resolveOnboardingRoute({
        attempt: PASSED,
        answers: answers('identity', 'biological_sex', 'primary_training_goal', 'focus_areas'),
      }),
    ]

    expect(walked).toEqual(ONBOARDING_STEPS.map((step) => step.route))
    // And before the gate is passed, no step is offered at all.
    expect(resolveOnboardingRoute({ attempt: null })).toBe(ELIGIBILITY_GATE_ROUTE)
  })
})

describe('guardStep', () => {
  const ANSWERED: OnboardingProgress = {
    attempt: PASSED,
    answers: answers('identity', 'biological_sex', 'primary_training_goal'),
  }

  test('lets a step already answered be opened, because that is editing', () => {
    expect(guardStep('/onboarding/identity', ANSWERED)).toBeNull()
    expect(guardStep('/onboarding/sex', ANSWERED)).toBeNull()
  })

  test('lets the current step through', () => {
    expect(
      guardStep('/onboarding/sex', { attempt: PASSED, answers: answers('identity') }),
    ).toBeNull()
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
    expect(lastRevisitableStep()).toBe('/onboarding/experience')
  })

  test('follows the declared order rather than a name written once', () => {
    const revisitable = ONBOARDING_STEPS.filter((step) => step.revisitable).map(
      (step) => step.route,
    )

    expect(revisitable).not.toHaveLength(0)
    expect(lastRevisitableStep()).toBe(revisitable[revisitable.length - 1] ?? null)
  })
})

describe('nextRouteAfter', () => {
  test('hands each step to the next one in the declared order', () => {
    expect(nextRouteAfter('/onboarding/identity')).toBe('/onboarding/sex')
    expect(nextRouteAfter('/onboarding/sex')).toBe('/onboarding/goal')
  })

  test('sends the last step to the terminal, not to a step that does not exist', () => {
    const last = ONBOARDING_STEPS.at(-1)
    if (!last) throw new Error('the declared order cannot be empty')
    expect(nextRouteAfter(last.route)).toBe('/onboarding/continues')
  })

  test('never skips a step, which is the defect it exists to prevent', () => {
    // Walking forward from the first step must visit every declared route in
    // order. A screen that hardcodes its destination cannot make this promise.
    const walked: string[] = []
    let route: string = FIRST_STEP_ROUTE
    while (route !== '/onboarding/continues') {
      walked.push(route)
      route = nextRouteAfter(route as never)
    }

    expect(walked).toEqual(ONBOARDING_STEPS.map((step) => step.route))
  })
})

describe('the focus step', () => {
  test('comes after the goal, which is what HU-SP-097 depends on', () => {
    expect(nextRouteAfter('/onboarding/goal')).toBe('/onboarding/focus')
  })

  test('hands over to the experience, which was appended after it', () => {
    expect(nextRouteAfter('/onboarding/focus')).toBe('/onboarding/experience')
  })

  test('reads answered rather than a value, because whole body leaves none', () => {
    const passed = { eligibility_status: 'pass' as const }
    const upTo = answers('identity', 'biological_sex', 'primary_training_goal')

    expect(resolveOnboardingRoute({ attempt: passed, answers: upTo })).toBe('/onboarding/focus')
    expect(
      resolveOnboardingRoute({
        attempt: passed,
        answers: { ...upTo, focus_areas: { answered: true } },
      }),
    ).toBe('/onboarding/experience')
  })
})

describe('the experience step', () => {
  test('comes after the focus', () => {
    expect(nextRouteAfter('/onboarding/focus')).toBe('/onboarding/experience')
  })

  test('is the last step, so it hands over to the terminal', () => {
    expect(nextRouteAfter('/onboarding/experience')).toBe('/onboarding/continues')
  })

  test('is owed until it is answered', () => {
    const passed = { eligibility_status: 'pass' as const }
    const upTo = answers('identity', 'biological_sex', 'primary_training_goal', 'focus_areas')

    expect(resolveOnboardingRoute({ attempt: passed, answers: upTo })).toBe(
      '/onboarding/experience',
    )
    expect(
      resolveOnboardingRoute({
        attempt: passed,
        answers: { ...upTo, training_experience: { answered: true } },
      }),
    ).toBe('/onboarding/continues')
  })

  test('cannot be reached before the focus is answered', () => {
    // Not because the level depends on the zones, but because no screen may let a
    // prerequisite be skipped: that is what `guardStep` is for.
    const passed = { eligibility_status: 'pass' as const }
    const upTo = answers('identity', 'biological_sex', 'primary_training_goal')

    expect(guardStep('/onboarding/experience', { attempt: passed, answers: upTo })).toBe(
      '/onboarding/focus',
    )
  })
})
