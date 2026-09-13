import { describe, expect, test } from 'bun:test'
import type { BodyPart } from 'react-native-body-highlighter'

import { figureGroups, figureIds, hiddenFor, roleFor } from './body-figure'

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
    expect(new Set([...Object.values(front), ...Object.values(back)]).size).toBe(6)
  })
})
