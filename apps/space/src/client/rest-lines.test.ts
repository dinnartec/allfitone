import { describe, expect, test } from 'bun:test'

import { REST_LINES, restLine } from './rest-lines'
import { started } from './rest-timer'

const NOW = 1_000_000
const ninety = started(NOW, 90)

describe('what the rest bar says while it counts (ADR-035)', () => {
  test('T-SPC-UNIT-132 it opens saying what comes next', () => {
    expect(restLine(ninety, NOW + 1_000, 'Sigue con Remo')).toEqual({
      kind: 'next',
      text: 'Sigue con Remo',
    })
  })

  test('T-SPC-UNIT-133 in the middle of the rest it says something to keep going', () => {
    const middle = restLine(ninety, NOW + 30_000, 'Sigue con Remo')

    expect(middle.kind).toBe('phrase')
    expect(REST_LINES).toContain(middle.text)
  })

  test('T-SPC-UNIT-134 the same rest keeps the same phrase, so it never flickers', () => {
    const early = restLine(ninety, NOW + 20_000, 'Sigue con Remo')
    const later = restLine(ninety, NOW + 60_000, 'Sigue con Remo')

    expect(later.text).toBe(early.text)
  })

  test('T-SPC-UNIT-135 the last seconds go back to what comes next', () => {
    expect(restLine(ninety, NOW + 82_000, 'Sigue con Remo').kind).toBe('next')
  })

  test('T-SPC-UNIT-136 a rest too short for a phrase only says what comes next', () => {
    const short = started(NOW, 15)

    expect(restLine(short, NOW + 5_000, 'Sigue con Remo').kind).toBe('next')
  })

  test('T-SPC-UNIT-137 with nothing next to say, the phrase fills the whole rest', () => {
    expect(restLine(ninety, NOW + 1_000, '').kind).toBe('phrase')
  })
})
