import { describe, expect, test } from 'bun:test'

import {
  MEASURES,
  comparedPhotos,
  daysApart,
  decimal,
  declarationOf,
  massIn,
  monthTicks,
  tenths,
  timeline,
  latestOf,
  measureChange,
  runAround,
  seriesOf,
  shortDay,
  type BodyPhoto,
  type BodyRecord,
} from './body'

let next = 0
const record = (
  metric_code: BodyRecord['metric_code'],
  value: number,
  measured_on: string,
): BodyRecord => {
  next += 1
  return {
    id: `019f0000-0000-7000-8000-${String(next).padStart(12, '0')}`,
    metric_code,
    value,
    unit_code: metric_code === 'body_weight' ? 'kg' : metric_code === 'body_fat' ? 'percent' : 'cm',
    original_value: null,
    original_unit_code: null,
    measured_on,
    has_media: false,
    recorded_at: `${measured_on}T12:00:00.000Z`,
  }
}

const photo = (id: string, taken_on: string): BodyPhoto => ({
  id,
  taken_on,
  created_at: `${taken_on}T12:00:00.000Z`,
  photo: {
    url: `https://example.test/${id}.jpg`,
    expires_at: '2026-10-24T12:05:00.000Z',
    method: 'GET',
  },
})

const records = [
  record('body_weight', 70.2, '2026-10-24'),
  record('waist', 82, '2026-10-21'),
  record('body_weight', 70.6, '2026-10-21'),
  record('waist', 84, '2026-09-26'),
  record('body_weight', 72, '2026-08-02'),
  record('body_weight', 73.4, '2026-05-01'),
]

describe('the latest of each measurement', () => {
  test('T-SPC-UNIT-BODY-01 is the newest by the day it was measured', () => {
    expect(latestOf(records, 'body_weight')?.value).toBe(70.2)
    expect(latestOf(records, 'hip')).toBeUndefined()
  })

  test('T-SPC-UNIT-BODY-02 changes against the one measured before it', () => {
    expect(measureChange(records, 'body_weight')).toEqual({ change: -0.4, since: '2026-10-21' })
    expect(measureChange(records, 'waist')).toEqual({ change: -2, since: '2026-09-26' })
    expect(measureChange(records, 'chest')).toBeUndefined()
  })
})

describe('the weight over a range', () => {
  test('T-SPC-UNIT-BODY-03 keeps the months asked for, oldest first', () => {
    expect(seriesOf(records, 'body_weight', 3, '2026-10-24').map((point) => point.value)).toEqual([
      72, 70.6, 70.2,
    ])
  })
})

describe('reading a measurement', () => {
  test('T-SPC-UNIT-BODY-04 one decimal with a comma, none when it is whole', () => {
    expect(decimal(70.2)).toBe('70,2')
    expect(decimal(82)).toBe('82')
    expect(decimal(34.55)).toBe('34,6')
  })

  test('T-SPC-UNIT-BODY-10 a weight always reads with its tenth', () => {
    expect(tenths(71)).toBe('71,0')
    expect(tenths(70.25)).toBe('70,3')
  })

  test('T-SPC-UNIT-BODY-11 a mass reads in tenths of the unit it is shown in', () => {
    expect(massIn(71.1, 'kg')).toBe(71.1)
    expect(massIn(70, 'lb')).toBe(154.3)
  })

  test('T-SPC-UNIT-BODY-05 a day reads short and in Spanish', () => {
    expect(shortDay('2026-08-02')).toBe('2 ago')
  })

  test('T-SPC-UNIT-BODY-06 the measures are the ones the database keeps, without height', () => {
    expect(MEASURES.map((measure) => measure.code)).toEqual([
      'chest',
      'arm',
      'waist',
      'hip',
      'thigh',
      'body_fat',
      'muscle_mass',
    ])
  })
})

describe('the run a wheel turns through', () => {
  test('T-SPC-UNIT-BODY-07 steps evenly around the last reading, inside the bounds', () => {
    const run = runAround(70.2, 0.1, 20, 30, 250)
    expect(run[0]).toBe(50.2)
    expect(run.at(-1)).toBe(90.2)
    expect(run).toContain(70.2)
    expect(runAround(5, 0.5, 20, 3, 60)[0]).toBe(3)
  })
})

describe('the two photos compared', () => {
  const photos = [photo('c', '2026-10-24'), photo('b', '2026-09-26'), photo('a', '2026-08-02')]

  test('T-SPC-UNIT-BODY-08 are the oldest and the newest unless two were chosen', () => {
    expect(comparedPhotos(photos, []).map((one) => one.id)).toEqual(['a', 'c'])
    expect(comparedPhotos(photos, ['c', 'b']).map((one) => one.id)).toEqual(['b', 'c'])
    expect(comparedPhotos([photos[0] ?? photo('x', '2026-01-01')], [])).toHaveLength(1)
  })
})

describe('what a measure sends', () => {
  test('T-SPC-UNIT-BODY-09 each in the unit of its dimension', () => {
    expect(declarationOf('waist', 82, '2026-10-24')).toEqual({
      metric_code: 'waist',
      value: 82,
      unit: 'cm',
      measured_on: '2026-10-24',
    })
    expect(declarationOf('body_fat', 18, '2026-10-24').unit).toBe('percent')
    expect(declarationOf('muscle_mass', 32, '2026-10-24').unit).toBe('kg')
  })
})

describe('the weight line', () => {
  test('T-SPC-UNIT-BODY-12 each reading sits at its day across the range', () => {
    expect(
      timeline(
        [
          { measured_on: '2026-07-25', value: 72 },
          { measured_on: '2026-10-25', value: 70.8 },
        ],
        3,
        '2026-10-25',
      ),
    ).toEqual([
      { at: 0, value: 72 },
      { at: 1, value: 70.8 },
    ])
  })

  test('T-SPC-UNIT-BODY-13 a single reading still draws a line: held from the start of the range', () => {
    expect(timeline([{ measured_on: '2026-10-25', value: 71 }], 3, '2026-10-25')).toEqual([
      { at: 0, value: 71 },
      { at: 1, value: 71 },
    ])
  })

  test('T-SPC-UNIT-BODY-16 readings late in the range are held from its start', () => {
    expect(
      timeline(
        [
          { measured_on: '2026-10-20', value: 71 },
          { measured_on: '2026-10-25', value: 71.2 },
        ],
        1,
        '2026-10-25',
      ).map((point) => [Math.round(point.at * 100) / 100, point.value]),
    ).toEqual([
      [0, 71],
      [0.83, 71],
      [1, 71.2],
    ])
  })

  test('T-SPC-UNIT-BODY-14 the axis names the months of the range', () => {
    expect(monthTicks(3, '2026-10-25')).toEqual(['AGO', 'SEP', 'OCT'])
    expect(monthTicks(1, '2026-10-25')).toEqual(['SEP', 'OCT'])
    expect(monthTicks(12, '2026-10-25')).toEqual(['NOV', 'FEB', 'MAY', 'JUL', 'OCT'])
  })
})

describe('the time between two photos', () => {
  test('T-SPC-UNIT-BODY-15 is said in days, and the same day says so', () => {
    expect(daysApart('2026-08-02', '2026-10-25')).toBe('84 días')
    expect(daysApart('2026-10-24', '2026-10-25')).toBe('1 día')
    expect(daysApart('2026-10-25', '2026-10-25')).toBe('El mismo día')
  })
})
