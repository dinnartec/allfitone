/**
 * The training goal screen, minus the rendering.
 *
 * Everything here could have lived in `app/onboarding/goal.tsx` and been
 * impossible to check: `bun test src` is the only glob the workspace runs, and no
 * component renderer is installed, so anything left in `app/` is untestable.
 *
 * The geometry is measured from the laid-out row, never derived from the window.
 * That mistake was made twice on the sex screen and cost two rounds: `Screen`
 * already applies `panelInset` on each side, so computing from the window
 * double-counts the padding and the content overflows by exactly that much. The
 * other half of the same lesson is that a percentage width with no resolved base
 * makes Yoga fall back to the image's intrinsic size, which turned a portrait into
 * 747 pt of height.
 *
 * Which photo a goal shows depends on what the person declared one screen earlier.
 * Female brings the woman; male and declining bring the man. Declining is not a
 * third case with its own artwork: there is no neutral body, and inventing one
 * would be a worse answer than picking a default and saying so.
 */

/** The five offered in the initial V1 launch, in the order the screen lists them. */
export const TRAINING_GOALS = [
  'lose_weight',
  'build_muscle',
  'get_fit',
  'run_a_race',
  'maintain',
] as const

export type TrainingGoal = (typeof TRAINING_GOALS)[number]

/** The gap between the hero card and the rows below it. */
export const CARD_GAP = 8

/**
 * The hero band is flatter than a portrait: the bodies are cropped to the torso,
 * so height buys nothing and every point of it comes off the five rows.
 */
export const HERO_ASPECT = 16 / 6.9

/**
 * Everything in the frame that is not the hero card: header, title, lede, the five
 * rows, the button and the vertical padding. Measured, not guessed.
 */
export const CHROME_HEIGHT = 512

export interface HeroGeometry {
  cardWidth: number
  cardHeight: number
}

/**
 * The card fills the measured row and its height follows the aspect, unless the
 * screen is too short to afford it — a small device gives up card height rather
 * than pushing the button off the bottom.
 */
export function heroGeometry(rowWidth: number, screenHeight: number): HeroGeometry {
  const cardWidth = Math.max(0, rowWidth)
  const affordable = Math.max(0, screenHeight - CHROME_HEIGHT)
  return { cardWidth, cardHeight: Math.min(cardWidth / HERO_ASPECT, affordable) }
}

/**
 * When the sex question is declined, the artwork is mixed rather than defaulting
 * to one sex for everything. A screen where every goal shows a man would be a
 * statement, and declining is precisely the answer that asks us not to make one.
 * The split is decided per goal so the screen as a whole reads as neither.
 */
const DECLINED_VARIANT: Record<TrainingGoal, 'male' | 'female'> = {
  lose_weight: 'female',
  build_muscle: 'male',
  get_fit: 'female',
  run_a_race: 'male',
  maintain: 'male',
}

/**
 * Which body to show. Declared female brings the woman and declared male brings
 * the man; declining brings the mix above.
 */
export function bodyVariant(
  biologicalSex: 'male' | 'female' | null,
  goal: TrainingGoal,
): 'male' | 'female' {
  if (biologicalSex === 'female') return 'female'
  if (biologicalSex === 'male') return 'male'
  return DECLINED_VARIANT[goal]
}

export interface GoalSubmission {
  /** Undefined means nothing chosen yet, which is not the same as a choice. */
  goal: TrainingGoal | undefined
  submitting: boolean
  sessionExpired: boolean
}

export function canSubmitGoal({ goal, submitting, sessionExpired }: GoalSubmission): boolean {
  if (submitting || sessionExpired) return false
  return goal !== undefined
}

/** Share of the card width the pair may occupy, leaving the rest for the copy. */
export const STRIP_SHARE = 0.56

/**
 * How tall the figures may be. Fixing the height for every goal was wrong: the
 * running pair is a side profile and far wider per unit of height than the
 * standing ones, so at the same height it overflowed the card and pushed into the
 * copy. The width is what is scarce here, so the width decides, and the card
 * height is only a ceiling.
 */
export function pairHeight(
  cardWidth: number,
  cardHeight: number,
  beforeAspect: number,
  afterAspect: number,
  overlap: number,
  edge: number,
): number {
  const perUnitOfHeight = afterAspect * overlap + beforeAspect
  if (perUnitOfHeight <= 0) return 0
  const affordable = (cardWidth * STRIP_SHARE - edge) / perUnitOfHeight
  return Math.max(0, Math.min(cardHeight, affordable))
}

export interface GoalSlot {
  goal: TrainingGoal
  /** True for the one shown as the card, in its own place in the list. */
  expanded: boolean
}

/**
 * The list in its declared order, marking which entry opens as the card. The card
 * expands **in place** rather than at the top: pinning it to the top moved every
 * other row on every tap, so the thing you just chose jumped away from your
 * finger and the list had to be re-read to find out what happened.
 */
export function goalSlots(
  chosen: TrainingGoal | undefined,
  offered: readonly TrainingGoal[] = TRAINING_GOALS,
): readonly GoalSlot[] {
  return offered.map((goal) => ({ goal, expanded: goal === chosen }))
}
