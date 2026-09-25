import { describe, expect, test } from 'bun:test'

import { canSubmitSex, cardGeometry, CARD_GAP, CHROME_HEIGHT, PORTRAIT_ASPECT } from './sex-form'

// What the row actually measures on an iPhone 15 Pro: 393 wide, minus the 24 of
// `panelInset` that `Screen` applies on each side.
const ROW_WIDTH = 345
const SCREEN_HEIGHT = 852

describe('cardGeometry', () => {
  test('splits the measured row into two cards plus the gap', () => {
    const { cardWidth } = cardGeometry(ROW_WIDTH, SCREEN_HEIGHT)

    expect(cardWidth).toBe(167)
    // The pair must fit the row it was measured from, or the second card is cut
    // off at the screen edge — which is exactly what deriving it from the window
    // did, because that double-counted the design system's own padding.
    expect(cardWidth * 2 + CARD_GAP).toBe(ROW_WIDTH)
  })

  test('keeps the portrait at the framing the prototype approved', () => {
    const { cardWidth, portraitHeight } = cardGeometry(ROW_WIDTH, SCREEN_HEIGHT)

    expect(portraitHeight).toBeCloseTo(cardWidth / PORTRAIT_ASPECT, 5)
  })

  test('never returns the intrinsic height of the source image', () => {
    // A percentage width with no resolved base fell back to the image's own 420
    // points, and the aspect ratio made that 747 tall.
    expect(cardGeometry(ROW_WIDTH, SCREEN_HEIGHT).portraitHeight).toBeLessThan(400)
  })

  test('caps the portrait so the label and the button survive a short screen', () => {
    const short = cardGeometry(ROW_WIDTH, 600)

    expect(short.portraitHeight).toBe(600 - CHROME_HEIGHT)
    expect(short.portraitHeight).toBeLessThan(short.cardWidth / PORTRAIT_ASPECT)
  })

  test('returns zero before the row has been measured', () => {
    const geometry = cardGeometry(0, SCREEN_HEIGHT)

    expect(geometry.cardWidth).toBe(0)
    expect(geometry.portraitHeight).toBe(0)
  })
})

describe('canSubmitSex', () => {
  const base = { submitting: false, sessionExpired: false }

  test('refuses while nothing is chosen', () => {
    expect(canSubmitSex({ ...base, answer: undefined })).toBe(false)
  })

  test('allows a declared value', () => {
    expect(canSubmitSex({ ...base, answer: 'male' })).toBe(true)
    expect(canSubmitSex({ ...base, answer: 'female' })).toBe(true)
  })

  test('allows the refusal, because declining is an answer that must be sent', () => {
    // Null still goes to the server: the attempt records that the question was
    // answered, and without that the screen would ask again on every cold start.
    expect(canSubmitSex({ ...base, answer: null })).toBe(true)
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitSex({ answer: 'male', submitting: true, sessionExpired: false })).toBe(false)
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitSex({ answer: 'male', submitting: false, sessionExpired: true })).toBe(false)
  })
})
