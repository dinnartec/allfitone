import { describe, expect, test } from 'bun:test'

import { failureFor } from './api-error'

describe('failureFor', () => {
  test('T-SPC-UNIT-317 a refusal is not mistaken for a dropped connection', () => {
    expect(failureFor(403)).toBe('forbidden')
    expect(failureFor(404)).toBe('not-found')
    expect(failureFor(503)).toBe('unavailable')
    expect(failureFor(500)).toBe('unavailable')
  })
})
