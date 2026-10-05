import { describe, expect, test } from 'bun:test'

import { aboveDock, dockBottom } from './dock'

describe('what floats above the tab bar', () => {
  test('T-SPC-UNIT-248 the bar sits on the safe area, never closer than 12 to the edge', () => {
    expect(dockBottom(34)).toBe(34)
    expect(dockBottom(0)).toBe(12)
  })

  test('T-SPC-UNIT-249 a toast clears the bar wherever the bar is', () => {
    expect(aboveDock(34)).toBe(34 + 70 + 12)
    expect(aboveDock(0)).toBe(12 + 70 + 12)
  })
})
