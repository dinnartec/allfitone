/**
 * The order of the onboarding, declared once.
 *
 * Two things need to agree about it: where a returning person resumes, and how
 * far the progress bar has moved. They were about to be written twice — the route
 * decision as a chain of `if`s and the bar as a hardcoded count — and two
 * hardcoded copies of an order that is going to grow to about twenty screens
 * would drift on the first insertion. So the order is data, and both are derived.
 *
 * Each step declares how to tell, from what the server holds, whether it is
 * behind us. That predicate is the only place that knows what "answered" means
 * for that step, which matters because the answers are not alike: age is
 * evidence, the Fitness ID is a row, and the biological sex is a mark on the
 * attempt precisely because declining leaves no value.
 */

/**
 * Where the onboarding stops today. **Not** `/welcome`: that is the "create an
 * account" front door, and sending somebody who had answered everything there both
 * looked like starting over and looped — signing in again resolved to it right back.
 */
const CONTINUES_ROUTE = '/onboarding/continues'
const AGE_ROUTE = '/onboarding/age'
const IDENTITY_ROUTE = '/onboarding/identity'
const SEX_ROUTE = '/onboarding/sex'

export type OnboardingStepRoute = typeof IDENTITY_ROUTE | typeof SEX_ROUTE
export type OnboardingRoute = OnboardingStepRoute | typeof AGE_ROUTE | typeof CONTINUES_ROUTE

/** Only the shape the decisions read, so a test needs no generated DTO. */
export interface OnboardingProgress {
  attempt: { eligibility_status: 'pending' | 'pass' | 'fail' } | null
  /** Non-null once the Fitness ID exists. */
  identity?: unknown
  /**
   * Whether the biological sex question was put and answered. The value cannot
   * carry this: declining records no value, so reading the value alone would send
   * a decliner back to the same screen on every cold start.
   */
  biological_sex_answered?: boolean
}

interface OnboardingStep {
  readonly route: OnboardingStepRoute
  readonly answered: (progress: OnboardingProgress) => boolean
  /**
   * Whether a person may come back and change the answer. The adult declaration
   * cannot: it is credentialed evidence that gated the creation of the person, and
   * letting it be retracted would leave a Fitness ID that exists on the strength
   * of a declaration no longer standing. Everything else is theirs to correct.
   */
  readonly revisitable: boolean
}

/**
 * The adult declaration is a **gate, not a step**. It is credentialed evidence that
 * has to exist before a person can be created at all, it cannot be changed
 * afterwards, and it builds none of the profile — so it is not counted in the
 * progress bar and it carries no segment of its own. The first segment belongs to
 * the name.
 */
export const ELIGIBILITY_GATE_ROUTE = AGE_ROUTE

/** Exported so the screens and the entry decision agree on the terminal. */
export const ONBOARDING_CONTINUES_ROUTE = CONTINUES_ROUTE

const eligible = (progress: OnboardingProgress) => progress.attempt?.eligibility_status === 'pass'

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { route: IDENTITY_ROUTE, answered: (progress) => Boolean(progress.identity), revisitable: true },
  {
    route: SEX_ROUTE,
    answered: (progress) => Boolean(progress.biological_sex_answered),
    revisitable: true,
  },
]

/**
 * Where the onboarding resumes, given what the server already holds: the first
 * step still owed.
 */
export function resolveOnboardingRoute(current: OnboardingProgress | null): OnboardingRoute {
  // A `fail` is not eligibility and must not be walked past either.
  if (!current || !eligible(current)) return ELIGIBILITY_GATE_ROUTE
  // Everything declared so far is answered.
  return ONBOARDING_STEPS.find((step) => !step.answered(current))?.route ?? CONTINUES_ROUTE
}

export interface StepPosition {
  /** 1-based, for people rather than for arrays. */
  readonly position: number
  readonly total: number
  /** Steps already behind this one. */
  readonly completed: number
  /**
   * The nearest earlier step a person may go back and change. Null when there is
   * none, which is what leaves the first step without a back arrow — and what
   * keeps the arrow on the identity step from offering to edit the age.
   */
  readonly previous: OnboardingStepRoute | null
}

export function stepPosition(route: OnboardingStepRoute): StepPosition {
  const index = ONBOARDING_STEPS.findIndex((step) => step.route === route)
  return {
    position: index + 1,
    total: ONBOARDING_STEPS.length,
    completed: index,
    previous:
      ONBOARDING_STEPS.slice(0, Math.max(0, index))
        .reverse()
        .find((step) => step.revisitable)?.route ?? null,
  }
}

/**
 * Whether a screen entered directly has to send the person somewhere else.
 *
 * Only backwards. A person may open a step they already answered — that is what
 * the back arrow is for — so being ahead of the first owed step is not a reason to
 * move. Being *behind* one is: a prerequisite is missing and no screen may let it
 * be skipped.
 *
 * @returns the route to redirect to, or null to stay and let the answer be edited
 */
export function guardStep(
  step: OnboardingStepRoute,
  current: OnboardingProgress | null,
): OnboardingRoute | null {
  const owed = resolveOnboardingRoute(current)
  // Nothing owed at all: every step is open for editing.
  if (owed === CONTINUES_ROUTE) return null
  // The gate is not a step, so no step is ever ahead of it.
  if (owed === ELIGIBILITY_GATE_ROUTE) return owed

  const owedIndex = ONBOARDING_STEPS.findIndex((candidate) => candidate.route === owed)
  const stepIndex = ONBOARDING_STEPS.findIndex((candidate) => candidate.route === step)
  return owedIndex < stepIndex ? owed : null
}
