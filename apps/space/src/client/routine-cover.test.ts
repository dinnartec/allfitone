/**
 * `T-SP-COVER-01..09` — the cover as a decision, before it is a picture.
 *
 * The case worth naming is the last pair. «Sin portada» is a choice somebody makes, so
 * two absences have to compare equal or the tile that says so never looks selected; and
 * the muscles have to come out of the exercises rather than out of storage, or swapping
 * an exercise leaves the cover describing the routine that used to be there.
 */

import { describe, expect, test } from 'bun:test'

import type { Movement } from './content'
import {
  COVER_ICONS,
  coverIcon,
  glyphFor,
  iconCover,
  coverOrNothing,
  MUSCLE_COVER,
  PHOTO_COVER,
  musclesWorked,
  sameCover,
  type RoutineCover,
} from './routine-cover'

const movements: readonly Movement[] = [
  {
    id: '019f0000-0000-7000-8000-000000000001',
    discipline_code: 'strength',
    name: 'Press de banca',
    muscles: ['chest', 'triceps'],
    equipment: ['barbell'],
    demo_url: null,
  },
  {
    id: '019f0000-0000-7000-8000-000000000002',
    discipline_code: 'strength',
    name: 'Fondos',
    muscles: ['triceps', 'shoulders'],
    equipment: ['bodyweight'],
    demo_url: null,
  },
]

describe('the cover as a decision', () => {
  test('T-SP-COVER-01 an icon cover says which icon it is', () => {
    expect(coverIcon(iconCover('strength'))).toBe('strength')
  })

  test('T-SP-COVER-02 and no other kind names one', () => {
    expect(coverIcon(MUSCLE_COVER)).toBeUndefined()
    expect(coverIcon(undefined)).toBeUndefined()
  })

  test('T-SP-COVER-03 the same icon is the same choice', () => {
    expect(sameCover(iconCover('strength'), iconCover('strength'))).toBe(true)
    expect(sameCover(iconCover('strength'), iconCover('swim'))).toBe(false)
  })

  test('T-SP-COVER-04 kinds never match across', () => {
    expect(sameCover(MUSCLE_COVER, iconCover('strength'))).toBe(false)
  })

  test('T-SP-COVER-05 and no cover is a choice that matches itself', () => {
    // «Sin portada» is a tile somebody presses. Without this it never looks pressed.
    expect(sameCover(undefined, undefined)).toBe(true)
    expect(sameCover(undefined, MUSCLE_COVER)).toBe(false)
  })
})

describe('what a muscle cover draws', () => {
  test('T-SP-COVER-06 every muscle the exercises touch, once', () => {
    expect(
      musclesWorked(
        ['019f0000-0000-7000-8000-000000000001', '019f0000-0000-7000-8000-000000000002'],
        movements,
      ),
    ).toEqual(['chest', 'triceps', 'shoulders'])
  })

  test('T-SP-COVER-07 an exercise the library does not know draws nothing of its own', () => {
    expect(musclesWorked(['019f0000-0000-7000-8000-0000000000ff'], movements)).toEqual([])
  })

  test('T-SP-COVER-08 and a routine with no exercises has nothing to draw', () => {
    expect(musclesWorked([], movements)).toEqual([])
  })
})

describe('reading what the server sends', () => {
  test('T-SP-COVER-09 absent, null and a kind all read as what they are', () => {
    expect(coverOrNothing(undefined)).toBeUndefined()
    expect(coverOrNothing(null)).toBeUndefined()
    expect(coverOrNothing({ kind: 'muscles' })).toEqual(MUSCLE_COVER)
    expect(coverOrNothing({ kind: 'photo' })).toEqual(PHOTO_COVER)
    expect(coverOrNothing({ kind: 'icon', icon: 'strength' })).toEqual(iconCover('strength'))
  })
})

describe('the twelve', () => {
  test('T-SP-COVER-12 every one has a glyph and no two share a token', () => {
    // The grid is drawn from this list, so a token with no glyph is a blank tile and a
    // repeated token is two tiles that select each other.
    expect(COVER_ICONS.length).toBeGreaterThanOrEqual(32)
    expect(new Set(COVER_ICONS.map((one) => one.icon)).size).toBe(COVER_ICONS.length)
    for (const one of COVER_ICONS) expect(glyphFor(one.icon)).toBe(one.glyph)
  })

  test('T-SP-COVER-14 and every one has a name of its own', () => {
    // Two tiles reading «Fuerza» is two tiles a screen reader cannot tell apart, and the
    // grid draws no words at all.
    expect(new Set(COVER_ICONS.map((one) => one.name)).size).toBe(COVER_ICONS.length)
  })

  test('T-SP-COVER-13 a draft naming an icon this build lost is read as no cover', () => {
    // Forward compatibility, not paranoia: the vocabulary lives in the database and an
    // older app must draw the routine rather than crash on a word it does not know.
    const unknown = { kind: 'icon', icon: 'yoga' } as unknown as RoutineCover
    expect(coverOrNothing(unknown)).toBeUndefined()
  })
})
