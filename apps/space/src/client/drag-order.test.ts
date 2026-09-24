/**
 * `T-SP-DRAG-01..08` — where a dragged exercise lands and who moves out of its way.
 *
 * The cases that matter are the boundaries. A row one place below the one in the air
 * must move the moment the drag crosses it and not a pixel before; the row above it
 * must not move at all. Both are a single comparison away from being wrong, and wrong
 * here means somebody's routine comes out in an order they did not ask for.
 */

import { describe, expect, test } from 'bun:test'

import {
  EDGE_SPEED,
  EDGE_ZONE,
  ROW_SPAN,
  aside,
  edgeScroll,
  nextOffset,
  placeOf,
} from './drag-order'

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

describe('the list moving itself while a finger drags', () => {
  const LIST = { top: 200, height: 400 }

  test('T-SP-DRAG-09 a finger in the middle moves nothing', () => {
    expect(edgeScroll(400, LIST.top, LIST.height)).toBe(0)
  })

  test('T-SP-DRAG-10 pressed against the top edge it runs upwards at full speed', () => {
    expect(edgeScroll(LIST.top, LIST.top, LIST.height)).toBe(-EDGE_SPEED)
  })

  test('T-SP-DRAG-11 and against the bottom edge, downwards', () => {
    expect(edgeScroll(LIST.top + LIST.height, LIST.top, LIST.height)).toBe(EDGE_SPEED)
  })

  test('T-SP-DRAG-12 it creeps at the boundary and runs at the edge', () => {
    // A constant speed is the version that always feels wrong: too fast for a small
    // correction and too slow to cross a long list.
    const entering = Math.abs(edgeScroll(LIST.top + EDGE_ZONE - 1, LIST.top, LIST.height))
    const pressed = Math.abs(edgeScroll(LIST.top + 1, LIST.top, LIST.height))

    expect(entering).toBeGreaterThan(0)
    expect(entering).toBeLessThan(pressed)
  })

  test('T-SP-DRAG-13 past the edge it never goes faster than the cap', () => {
    expect(edgeScroll(LIST.top - 500, LIST.top, LIST.height)).toBe(-EDGE_SPEED)
    expect(edgeScroll(LIST.top + LIST.height + 500, LIST.top, LIST.height)).toBe(EDGE_SPEED)
  })

  test('T-SP-DRAG-14 a list that has not been measured yet does not scroll', () => {
    expect(edgeScroll(400, 0, 0)).toBe(0)
  })
})

describe('how far the list is allowed to chase', () => {
  test('T-SP-DRAG-15 it stops at the end of its own content', () => {
    // The defect: only the top was bounded, so a finger held at the bottom edge
    // scrolled past the content for as long as it was held, and the drag's
    // destination — which is fed by what was scrolled — ran off with it.
    expect(nextOffset(1000 - EDGE_SPEED + 1, EDGE_SPEED, 1000)).toBe(1000)
    expect(nextOffset(1000, EDGE_SPEED, 1000)).toBe(1000)
  })

  test('T-SP-DRAG-16 and at its beginning', () => {
    expect(nextOffset(4, -EDGE_SPEED, 1000)).toBe(0)
    expect(nextOffset(0, -EDGE_SPEED, 1000)).toBe(0)
  })

  test('T-SP-DRAG-17 a list shorter than its window cannot scroll at all', () => {
    expect(nextOffset(0, EDGE_SPEED, -50)).toBe(0)
  })

  test('T-SP-DRAG-18 in the middle it simply moves by what it was given', () => {
    expect(nextOffset(500, EDGE_SPEED, 1000)).toBe(500 + EDGE_SPEED)
  })
})
