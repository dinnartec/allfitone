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
/**
 * Where an activated person goes. Until `HU-SP-100` there was no such place, and the
 * onboarding's terminal screen doubled as one — which is why activating used to hold
 * on that screen instead of going anywhere.
 */
const TODAY_ROUTE = '/today'
const AGE_ROUTE = '/onboarding/age'
const IDENTITY_ROUTE = '/onboarding/identity'
const SEX_ROUTE = '/onboarding/sex'
const DISCIPLINE_ROUTE = '/onboarding/discipline'
const GOAL_ROUTE = '/onboarding/goal'
const FOCUS_ROUTE = '/onboarding/focus'
const EXPERIENCE_ROUTE = '/onboarding/experience'
const MEASURES_ROUTE = '/onboarding/measures'

export type OnboardingStepRoute =
  | typeof IDENTITY_ROUTE
  | typeof SEX_ROUTE
  | typeof DISCIPLINE_ROUTE
  | typeof GOAL_ROUTE
  | typeof FOCUS_ROUTE
  | typeof EXPERIENCE_ROUTE
  | typeof MEASURES_ROUTE
export type OnboardingRoute =
  OnboardingStepRoute | typeof AGE_ROUTE | typeof CONTINUES_ROUTE | typeof TODAY_ROUTE

/** Only the shape the decisions read, so a test needs no generated DTO. */
export interface OnboardingProgress {
  attempt: {
    /** `activated` is the end of the onboarding, and the only status that ends it. */
    status?: 'open' | 'activated' | 'ineligible' | 'expired'
    eligibility_status: 'pending' | 'pass' | 'fail'
  } | null
  /**
   * One entry per step, each carrying whether it was answered. `answered` is
   * separate from the value on purpose: declining the sex records no value, so
   * reading the value alone would send a decliner back to the same screen on
   * every cold start.
   */
  answers?: {
    identity?: { answered?: boolean }
    biological_sex?: { answered?: boolean }
    training_discipline?: { answered?: boolean }
    primary_training_goal?: { answered?: boolean }
    focus_areas?: { answered?: boolean }
    training_experience?: { answered?: boolean }
    /**
     * The two measurements are one entry with two members, and each screen reads its
     * own. `answered` on the entry means both were given; a step needs to know about
     * its own half, or answering the weight would carry the height with it.
     */
    body_measures?: {
      answered?: boolean
      value?: { weight?: unknown | null; height?: unknown | null } | null
    }
  }
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

/** The first screen of the app proper, and where activation now hands over. */
export const TODAY = TODAY_ROUTE

/** One reader for every step, so adding a step stays a line of data. */
const answered = (
  progress: OnboardingProgress,
  step: keyof NonNullable<OnboardingProgress['answers']>,
): boolean => progress.answers?.[step]?.answered === true

const eligible = (progress: OnboardingProgress) => progress.attempt?.eligibility_status === 'pass'

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    route: IDENTITY_ROUTE,
    answered: (progress) => answered(progress, 'identity'),
    revisitable: true,
  },
  {
    route: SEX_ROUTE,
    answered: (progress) => answered(progress, 'biological_sex'),
    revisitable: true,
  },
  {
    // Before the goal on purpose: the goal's list is filtered by the answer, so asking
    // them the other way round would offer goals the discipline does not pursue.
    route: DISCIPLINE_ROUTE,
    answered: (progress) => answered(progress, 'training_discipline'),
    revisitable: true,
  },
  {
    route: GOAL_ROUTE,
    answered: (progress) => answered(progress, 'primary_training_goal'),
    revisitable: true,
  },
  {
    route: FOCUS_ROUTE,
    answered: (progress) => answered(progress, 'focus_areas'),
    revisitable: true,
  },
  {
    route: EXPERIENCE_ROUTE,
    answered: (progress) => answered(progress, 'training_experience'),
    revisitable: true,
  },
  {
    route: MEASURES_ROUTE,
    // Both members, not the entry's own `answered`: a half-finished pair leaves the
    // step owed and the screen reopens on what it already has.
    answered: (progress) =>
      progress.answers?.body_measures?.value?.weight != null &&
      progress.answers?.body_measures?.value?.height != null,
    revisitable: true,
  },
]

/** The first step, which is where the eligibility gate hands over. */
export const FIRST_STEP_ROUTE: OnboardingStepRoute = IDENTITY_ROUTE

/**
 * Where a step goes once it is answered. Derived from the declared order rather
 * than written into each screen: the destination used to be hardcoded in three
 * places, so adding a step meant remembering all three, and the one time it was
 * forgotten the sex screen kept jumping straight to the terminal and skipped the
 * goal entirely.
 */
export function nextRouteAfter(step: OnboardingStepRoute): OnboardingRoute {
  const index = ONBOARDING_STEPS.findIndex((candidate) => candidate.route === step)
  if (index < 0) return CONTINUES_ROUTE
  return ONBOARDING_STEPS[index + 1]?.route ?? CONTINUES_ROUTE
}

/**
 * Where the onboarding resumes, given what the server already holds: the first
 * step still owed.
 */
export function resolveOnboardingRoute(current: OnboardingProgress | null): OnboardingRoute {
  // Checked before anything else, and not derived from the answers: activation is
  // what ends the onboarding, so nothing an answer says can send an activated
  // person back to a step — nor to the screen that ends it.
  if (current?.attempt?.status === 'activated') return TODAY_ROUTE
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

/**
 * The last step a person may go back and change.
 *
 * What the terminal screen points its arrow at. Derived rather than named, so it
 * follows the declared order when steps are appended instead of pointing at
 * whatever was last when it was written.
 */
export function lastRevisitableStep(): OnboardingStepRoute | null {
  return (
    ONBOARDING_STEPS.slice()
      .reverse()
      .find((step) => step.revisitable)?.route ?? null
  )
}
