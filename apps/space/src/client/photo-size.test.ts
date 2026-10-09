/**
 * How much a meal photo shrinks on the phone before it is sent.
 *
 * The API keeps 1600 px on the long side (`ADR-039`), so anything beyond that crossed
 * the network to be thrown away: two to three megabytes per photo, twice, for the
 * recognition and for the meal. Shrunk on the phone to the same edge, what is stored is
 * the same and what travels is a fraction.
 */

import { describe, expect, test } from 'bun:test'

import { PHOTO_EDGE, shrinkTo } from './photo-size'

describe('shrinkTo', () => {
  test('T-SPC-UNIT-284 a photo larger than the stored edge shrinks along its long side', () => {
    expect(PHOTO_EDGE).toBe(1600)
    expect(shrinkTo(4032, 3024)).toEqual({ width: 1600 })
    expect(shrinkTo(3024, 4032)).toEqual({ height: 1600 })
    expect(shrinkTo(2000, 2000)).toEqual({ width: 1600 })
  })

  test('T-SPC-UNIT-285 a photo already within the edge is left as it is', () => {
    expect(shrinkTo(1600, 1200)).toBeNull()
    expect(shrinkTo(800, 600)).toBeNull()
  })
})
