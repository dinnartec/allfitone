import { describe, expect, test } from 'bun:test'

import { freeOfferCaption, openSessionBar, sessionHeading } from './free-training'

const OPEN = '019e4000-0000-7000-8000-000000000901'

describe('free training on Today and in the session', () => {
  test('T-SPC-UNIT-302 the offer says when a free session is already open', () => {
    expect(freeOfferCaption(null)).toBe('Sin programa, registras sobre la marcha')
    expect(freeOfferCaption(OPEN)).toBe('Tienes uno en curso: tócalo para volver')
  })

  test('T-SPC-UNIT-303 the open bar carries the routine first, then the free session', () => {
    const planned = { executionId: 'planned', title: 'Tirón' }
    expect(openSessionBar(planned, OPEN)).toEqual(planned)
    expect(openSessionBar(undefined, OPEN)).toEqual({ executionId: OPEN, title: 'Entreno libre' })
    expect(openSessionBar(undefined, null)).toBeUndefined()
  })

  test('T-SPC-UNIT-304 a session with no routine is called a free one, and says so', () => {
    expect(sessionHeading(null, '')).toEqual({
      title: 'Entreno libre',
      line: 'Sin rutina asignada',
    })
    expect(sessionHeading(null, 'Pecho · Hombros')).toEqual({
      title: 'Entreno libre',
      line: 'Pecho · Hombros',
    })
    expect(sessionHeading('Tirón', 'Espalda')).toEqual({ title: 'Tirón', line: 'Espalda' })
    expect(sessionHeading('Tirón', '')).toEqual({ title: 'Tirón', line: '' })
  })
})
