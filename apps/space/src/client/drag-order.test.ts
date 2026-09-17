/**
 * `T-SP-DRAG-01..08` — where a dragged exercise lands and who moves out of its way.
 *
 * The cases that matter are the boundaries. A row one place below the one in the air
 * must move the moment the drag crosses it and not a pixel before; the row above it
 * must not move at all. Both are a single comparison away from being wrong, and wrong
 * here means somebody's routine comes out in an order they did not ask for.
 */

import { describe, expect, test } from 'bun:test'

import { ROW_SPAN, aside, placeOf } from './drag-order'

describe('where the row lands', () => {
  test('T-SP-DRAG-01 a drag of one row-worth moves it exactly one place', () => {
    expect(placeOf(2, ROW_SPAN, 5)).toBe(3)
    expect(placeOf(2, -ROW_SPAN, 5)).toBe(1)
  })

  test('T-SP-DRAG-02 past halfway commits to the nearer place, short of it stays', () => {
    // Truncating would leave a row that has visibly crossed its neighbour behind it.
    expect(placeOf(2, ROW_SPAN * 0.6, 5)).toBe(3)
    expect(placeOf(2, ROW_SPAN * 0.4, 5)).toBe(2)
  })

  test('T-SP-DRAG-03 it cannot be dragged off either end of the list', () => {
    expect(placeOf(1, -ROW_SPAN * 9, 5)).toBe(1)
    expect(placeOf(5, ROW_SPAN * 9, 5)).toBe(5)
  })
})

describe('who steps aside', () => {
  test('T-SP-DRAG-04 the row being dragged never steps aside from itself', () => {
    expect(aside(2, 2, ROW_SPAN * 2, 5)).toBe(0)
  })

  test('T-SP-DRAG-05 dragging down, the rows it passes move up by one place', () => {
    // Row 2 in the air, landing on 4: rows 3 and 4 move up, row 5 does not.
    expect(aside(3, 2, ROW_SPAN * 2, 5)).toBe(-ROW_SPAN)
    expect(aside(4, 2, ROW_SPAN * 2, 5)).toBe(-ROW_SPAN)
    expect(aside(5, 2, ROW_SPAN * 2, 5)).toBe(0)
  })

  test('T-SP-DRAG-06 dragging up, they move down instead', () => {
    // Row 4 in the air, landing on 2: rows 2 and 3 move down, row 1 does not.
    expect(aside(2, 4, -ROW_SPAN * 2, 5)).toBe(ROW_SPAN)
    expect(aside(3, 4, -ROW_SPAN * 2, 5)).toBe(ROW_SPAN)
    expect(aside(1, 4, -ROW_SPAN * 2, 5)).toBe(0)
  })

  test('T-SP-DRAG-07 nothing moves until the drag has actually crossed somebody', () => {
    for (const position of [1, 2, 3, 4, 5]) {
      expect(aside(position, 3, ROW_SPAN * 0.4, 5)).toBe(0)
    }
  })

  test('T-SP-DRAG-08 a row steps aside by one place and never by two', () => {
    // The gap the dragged row leaves is one row wide however far it travels, so
    // anybody moving out of its way moves exactly one place.
    const offsets = [1, 2, 3, 4, 5].map((position) => aside(position, 1, ROW_SPAN * 4, 5))

    expect(new Set(offsets.map(Math.abs))).toEqual(new Set([0, ROW_SPAN]))
  })
})
