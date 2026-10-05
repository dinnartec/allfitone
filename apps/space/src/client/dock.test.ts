import { describe, expect, test } from 'bun:test'

import { aboveDock, dockBottom, dropMaterial, dropOffset, nearestTab, stretchFor } from './dock'

describe('what floats above the tab bar', () => {
  test('T-SPC-UNIT-248 the bar sits on the safe area, never closer than 12 to the edge', () => {
    expect(dockBottom(34)).toBe(34)
    expect(dockBottom(0)).toBe(12)
  })

  test('T-SPC-UNIT-249 a toast clears the bar wherever the bar is', () => {
    expect(aboveDock(34)).toBe(34 + 70 + 12)
    expect(aboveDock(0)).toBe(12 + 70 + 12)
  })

  test('T-SPC-UNIT-250 the drop is liquid glass where the phone has it, else a tint', () => {
    expect(dropMaterial({ liquidGlass: true, reduceTransparency: false })).toBe('glass')
    expect(dropMaterial({ liquidGlass: false, reduceTransparency: false })).toBe('tint')
    expect(dropMaterial({ liquidGlass: true, reduceTransparency: true })).toBe('tint')
  })

  test('T-SPC-UNIT-251 the drop sits on its tab, and a release lands on the nearest one', () => {
    // A bar 400 wide with 2 of padding: four columns of 99.
    expect(dropOffset(0, 400, 4)).toBe(2)
    expect(dropOffset(2, 400, 4)).toBe(200)
    expect(nearestTab(150, 400, 4)).toBe(1)
    expect(nearestTab(160, 400, 4)).toBe(2)
    expect(nearestTab(-80, 400, 4)).toBe(0)
    expect(nearestTab(900, 400, 4)).toBe(3)
  })

  test('T-SPC-UNIT-252 the faster the drop moves, the more it stretches, up to a limit', () => {
    expect(stretchFor(0)).toBe(0)
    expect(stretchFor(-1200)).toBe(0.5)
    expect(stretchFor(9000)).toBe(1)
  })
})
