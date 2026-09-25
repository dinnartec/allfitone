/**
 * The two decisions the biological-sex screen makes, kept where they can be tested.
 *
 * `bun test src` is the only glob the workspace runs, and there is no component
 * renderer installed, so anything left in `app/` cannot be checked at all. The
 * identity screen already answers that by keeping its submit gate in
 * `identity-form.ts`; this is the same split, and the geometry is here for a
 * concrete reason.
 *
 * **The geometry has been wrong twice, in two different ways.** First with
 * `width: '100%'` and `aspectRatio` inside a card that was `flex: 1` with
 * `alignItems: 'center'`: the percentage had no resolved base, Yoga fell back to the
 * image's intrinsic 420 points and the aspect ratio made that 747 tall, so the card
 * swallowed the screen. Then by computing from the window, which double-counted
 * padding — `Screen` already applies 24 points of `panelInset` on each side — and the
 * row overflowed by exactly 48, cutting the second card off at the edge.
 *
 * So the width is not derived at all any more: it is **measured** from the row that
 * actually holds the cards, via `onLayout`. A measured container cannot disagree with
 * whatever the design system decides to pad.
 */

export const CARD_GAP = 11

/** Width over height, as the approved prototype framed it. */
export const PORTRAIT_ASPECT = 9 / 16

/**
 * Everything on the screen that is not a portrait: heading, lede, the decline
 * card, the button and the vertical padding. Measured against the approved
 * prototype rather than guessed, and it is what keeps the portraits from growing
 * until the label falls below the fold on a short device.
 */
export const CHROME_HEIGHT = 416

export interface CardGeometry {
  cardWidth: number
  portraitHeight: number
}

/**
 * @param rowWidth  measured width of the row holding both cards, from `onLayout`
 * @param screenHeight  window height, only to keep the label and button on screen
 */
export function cardGeometry(rowWidth: number, screenHeight: number): CardGeometry {
  const cardWidth = Math.max(0, (rowWidth - CARD_GAP) / 2)
  const available = Math.max(0, screenHeight - CHROME_HEIGHT)
  return {
    cardWidth,
    portraitHeight: Math.min(cardWidth / PORTRAIT_ASPECT, available),
  }
}

/** Null is the refusal and it is an answer; `undefined` is nothing chosen yet. */
export type SexAnswer = 'male' | 'female' | null

export function canSubmitSex(state: {
  answer: SexAnswer | undefined
  submitting: boolean
  sessionExpired: boolean
}): boolean {
  if (state.answer === undefined) return false
  // Pressing with a dead session could only fail, so the button says so first.
  return !state.submitting && !state.sessionExpired
}
