import { describe, expect, test } from 'bun:test'
import type { BodyPart } from 'react-native-body-highlighter'

import { drawsAny, figureGroups, figureIds, hiddenFor, roleFor, sideShowing } from './body-figure'

const PARTS: BodyPart[] = [
  { slug: 'chest', path: { left: ['M0 0'], right: ['M1 1'] } },
  { slug: 'head', path: { common: ['M2 2'] } },
  { slug: 'hair', path: { common: ['M3 3'] } },
  { slug: 'biceps', path: { left: ['M4 4'], right: ['M5 5'] } },
]

const LIT = ['chest']
const INERT = ['head', 'hair', 'neck']

describe('which paths the figure draws', () => {
  test('T-SP-BODY-01 the head is drawn, because it only has a common path', () => {
    // Walking left/right alone drops it in silence and the figure comes out
    // decapitated. This is the whole reason the module exists.
    const drawn = figureGroups({ parts: PARTS, side: 'front', lit: LIT, inert: INERT })

    expect(drawn.some((group) => group.slug === 'head')).toBe(true)
  })

  test('T-SP-BODY-02 both members of a paired muscle are drawn, not just one', () => {
    const drawn = figureGroups({ parts: PARTS, side: 'front', lit: LIT, inert: INERT })

    expect(drawn.find((group) => group.slug === 'chest')?.paths).toEqual(['M0 0', 'M1 1'])
  })

  test('T-SP-BODY-03 hair is dropped on the front, where its locks read as spikes', () => {
    const front = figureGroups({ parts: PARTS, side: 'front', lit: LIT, inert: INERT })

    expect(front.some((group) => group.slug === 'hair')).toBe(false)
    expect(hiddenFor('front')).toEqual(['hair'])
  })

  test('T-SP-BODY-09 and kept on the back, where it is the back of the skull', () => {
    // Dropping it there left the head open — a dark hollow with the ears sticking out
    // of it, which only showed once the figure was drawn large.
    const back = figureGroups({ parts: PARTS, side: 'back', lit: LIT, inert: INERT })

    expect(back.some((group) => group.slug === 'hair')).toBe(true)
    expect(hiddenFor('back')).toEqual([])
  })

  test('T-SP-BODY-04 one node per muscle, not one per path, or a tap re-diffs 157 of them', () => {
    // A face is 64 to 90 `d` strings and the screen shows two at once. Grouping is
    // what took the figure from seconds to answer down to a tap.
    const drawn = figureGroups({ parts: PARTS, side: 'front', lit: LIT, inert: INERT })

    expect(drawn).toHaveLength(3)
    expect(new Set(drawn.map((group) => group.slug)).size).toBe(drawn.length)
  })

  test('T-SP-BODY-05 a part with no slug or no geometry is skipped, not drawn unattributed', () => {
    const drawn = figureGroups({
      side: 'front',
      parts: [
        { path: { common: ['M9 9'] } },
        { slug: 'abs', path: {} },
        { slug: 'calves', path: { common: [''] } },
      ],
      lit: [],
      inert: [],
    })

    expect(drawn).toEqual([])
  })
})

describe('how each path is painted', () => {
  test('T-SP-BODY-06 inert wins over lit, so the head never lights with a zone', () => {
    expect(roleFor('head', ['head'], INERT)).toBe('inert')
  })

  test('T-SP-BODY-10 what a movement merely uses is shaded, not lit', () => {
    // A bench press trains the chest and uses the triceps. Painting both the same
    // would say they are the same thing, and the detail screen exists to say they
    // are not.
    expect(roleFor('triceps', ['chest'], INERT, ['triceps'])).toBe('secondary')
    expect(roleFor('biceps', ['chest'], INERT, ['triceps'])).toBe('resting')
  })

  test('T-SP-BODY-11 a muscle that is both is what the movement trains', () => {
    expect(roleFor('chest', ['chest'], INERT, ['chest'])).toBe('lit')
  })

  test('T-SP-BODY-07 a chosen muscle is lit and the rest rest', () => {
    const drawn = figureGroups({ parts: PARTS, side: 'front', lit: LIT, inert: INERT })

    expect(drawn.find((group) => group.slug === 'chest')?.role).toBe('lit')
    expect(drawn.find((group) => group.slug === 'biceps')?.role).toBe('resting')
    expect(drawn.find((group) => group.slug === 'head')?.role).toBe('inert')
  })
})

describe('the two faces do not share their definitions', () => {
  test('T-SP-BODY-08 front and back namespace their ids, or one would paint the other', () => {
    const front = figureIds('front')
    const back = figureIds('back')

    expect(front.lit).not.toBe(back.lit)
    expect(new Set([...Object.values(front), ...Object.values(back)]).size).toBe(
      Object.keys(front).length * 2,
    )
  })
})

describe('which single face to show', () => {
  // The parts each face actually draws, kept apart: the point of the choice is that
  // they are not the same list.
  const FRONT: BodyPart[] = [
    { slug: 'chest', path: { left: ['M0 0'] } },
    { slug: 'head', path: { common: ['M2 2'] } },
  ]
  const BACK: BodyPart[] = [
    { slug: 'upper-back', path: { left: ['M6 6'] } },
    { slug: 'gluteal', path: { left: ['M7 7'] } },
  ]

  test('T-SP-BODY-12 the front leads when it draws what is lit', () => {
    expect(sideShowing({ front: FRONT, back: BACK, lit: ['chest'] })).toBe('front')
  })

  test('T-SP-BODY-13 the back wins when the front shows none of it', () => {
    // The defect this prevents: an inset of the front for a row, which says nothing
    // about the movement at all.
    expect(sideShowing({ front: FRONT, back: BACK, lit: ['upper-back'] })).toBe('back')
  })

  test('T-SP-BODY-14 a muscle no face draws falls back to the front, not to nothing', () => {
    expect(sideShowing({ front: FRONT, back: BACK, lit: ['cardio'] })).toBe('front')
    expect(sideShowing({ front: FRONT, back: BACK, lit: [] })).toBe('front')
  })

  test('T-SP-BODY-15 a hidden part does not count as drawn', () => {
    // Hair is dropped on the front, so it cannot be the reason the front is chosen.
    const withHair: BodyPart[] = [...FRONT, { slug: 'hair', path: { common: ['M3 3'] } }]

    expect(drawsAny(withHair, 'front', ['hair'])).toBe(false)
    expect(drawsAny(withHair, 'back', ['hair'])).toBe(true)
  })
})
