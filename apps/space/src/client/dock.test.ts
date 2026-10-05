import { describe, expect, test } from 'bun:test'

import {
  aboveDock,
  dockBottom,
  dropMaterial,
  dropOffset,
  nearestTab,
  onDrop,
  stretchFor,
  tabAt,
  travelStretch,
} from './dock'

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

  test('T-SPC-UNIT-253 a touch holds the drop when it lands on it, with a little room around', () => {
    // A drop at 200, 95 wide.
    expect(onDrop(250, 200, 95)).toBe(true)
    expect(onDrop(190, 200, 95)).toBe(true)
    expect(onDrop(305, 200, 95)).toBe(true)
    expect(onDrop(100, 200, 95)).toBe(false)
  })

  test('T-SPC-UNIT-262 a tap answers with the tab under the finger, inside the bar', () => {
    // 4 columns of 100 between 2 points of padding at each end.
    expect(tabAt(50, 404, 4)).toBe(0)
    expect(tabAt(103, 404, 4)).toBe(1)
    expect(tabAt(399, 404, 4)).toBe(3)
    expect(tabAt(-5, 404, 4)).toBe(0)
    expect(tabAt(410, 404, 4)).toBe(3)
  })

  test('T-SPC-UNIT-265 a travelling drop stretches with its speed, so it is longest mid-way', () => {
    // 16 points in a 16 ms frame is 1000 points a second.
    expect(travelStretch(16, 16)).toBeCloseTo(1000 / 1600)
    expect(travelStretch(-16, 16)).toBeCloseTo(1000 / 1600)
    expect(travelStretch(2, 16)).toBeLessThan(travelStretch(8, 16))
    expect(travelStretch(64, 16)).toBe(1)
    // A frame that did not move, or no time at all, does not stretch it.
    expect(travelStretch(0, 16)).toBe(0)
    expect(travelStretch(10, 0)).toBe(0)
  })
})
