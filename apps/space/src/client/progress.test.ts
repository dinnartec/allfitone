import { describe, expect, test } from 'bun:test'

import {
  cumulativeVolume,
  formatKilos,
  liftedUp,
  movementsAt,
  muscleRows,
  percentChange,
  periodLabel,
  periodStart,
  previousStart,
  programOptions,
  sparkline,
  untrained,
  type Period,
  type PeriodMovement,
} from './progress'

const period = (starts_on: string, overrides: Partial<Period> = {}): Period => ({
  starts_on,
  sessions: 0,
  active_days: 0,
  trained_seconds: 0,
  work_sets: 0,
  volume_kg: null,
  planned: 0,
  fulfilled: 0,
  unplanned: 0,
  muscles: [],
  days: [],
  ...overrides,
})

const movement = (name: string, bests: (number | null)[]): PeriodMovement => {
  const trained = bests.filter((best): best is number => best !== null)
  const best = trained.at(-1) ?? 0
  const previous = trained.length > 1 ? (trained.at(-2) ?? null) : null
  return {
    movement_id: `id-${name}`,
    name,
    best_kg: best,
    previous_best_kg: previous,
    change_kg: previous === null ? null : best - previous,
    bests,
  }
}

describe('naming a period', () => {
  test('T-SPC-UNIT-PROG-01 a week reads as its days, a month as its name', () => {
    expect(periodLabel('2026-10-19', 'week')).toBe('19 – 25 oct')
    expect(periodLabel('2026-09-28', 'week')).toBe('28 sep – 4 oct')
    expect(periodLabel('2026-10-01', 'month')).toBe('Octubre 2026')
  })
})

describe('the change against the period before', () => {
  test('T-SPC-UNIT-PROG-02 is a rounded percentage, and nothing when there is nothing to compare', () => {
    expect(percentChange(12480, 10600)).toBe(18)
    expect(percentChange(8000, 10000)).toBe(-20)
    expect(percentChange(5000, null)).toBeNull()
    expect(percentChange(5000, 0)).toBeNull()
    expect(percentChange(null, 5000)).toBeNull()
  })

  test('T-SPC-UNIT-PROG-03 kilos read with a decimal comma and a thousands dot', () => {
    expect(formatKilos(12480)).toBe('12.480')
    expect(formatKilos(92.5)).toBe('92,5')
    expect(formatKilos(80)).toBe('80')
  })
})

describe('the volume, day by day', () => {
  const days = [
    { trained_on: '2026-10-19', volume_kg: 3600 },
    { trained_on: '2026-10-21', volume_kg: 4500 },
    { trained_on: '2026-10-22', volume_kg: null },
    { trained_on: '2026-10-14', volume_kg: 3200 },
  ]

  test('T-SPC-UNIT-PROG-04 adds up across the week and stops at today', () => {
    expect(cumulativeVolume(days, '2026-10-19', 'week', '2026-10-22')).toEqual([
      3600,
      3600,
      8100,
      8100,
      null,
      null,
      null,
    ])
  })

  test('T-SPC-UNIT-PROG-05 a finished week runs to its last day', () => {
    expect(cumulativeVolume(days, '2026-10-12', 'week', '2026-10-22')).toEqual([
      0, 0, 3200, 3200, 3200, 3200, 3200,
    ])
  })

  test('T-SPC-UNIT-PROG-06 a month has one point per day', () => {
    expect(cumulativeVolume(days, '2026-10-01', 'month', '2026-10-31')).toHaveLength(31)
  })
})

describe('the muscles of a period', () => {
  test('T-SPC-UNIT-PROG-07 each muscle against the heaviest, heaviest first', () => {
    const latest = period('2026-10-19', {
      muscles: [
        { code: 'lats', name: 'Dorsal', sets: 14 },
        { code: 'biceps', name: 'Bíceps', sets: 7 },
      ],
    })
    expect(muscleRows(latest)).toEqual([
      { code: 'lats', name: 'Dorsal', sets: 14, share: 1 },
      { code: 'biceps', name: 'Bíceps', sets: 7, share: 0.5 },
    ])
  })

  test('T-SPC-UNIT-PROG-08 says what was trained before and not now', () => {
    const before = period('2026-10-12', {
      muscles: [
        { code: 'quads', name: 'Cuádriceps', sets: 12 },
        { code: 'lats', name: 'Dorsal', sets: 10 },
      ],
    })
    const now = period('2026-10-19', { muscles: [{ code: 'lats', name: 'Dorsal', sets: 14 }] })
    expect(untrained(now, before)).toEqual(['Cuádriceps'])
  })
})

describe('the loads that went up', () => {
  test('T-SPC-UNIT-PROG-09 only what rose, the biggest rise first', () => {
    const rows = liftedUp([
      movement('Press banca', [60, null, 65]),
      movement('Sentadilla', [80, 80, 92.5]),
      movement('Remo', [55, 50]),
      movement('Curl', [12]),
    ])
    expect(rows.map((row) => [row.name, row.change_kg])).toEqual([
      ['Sentadilla', 12.5],
      ['Press banca', 5],
    ])
  })

  test('T-SPC-UNIT-PROG-10 the trend skips the periods it was not trained in', () => {
    expect(sparkline([60, null, 65, 70], 60, 24)).toBe('M0 24 L30 12 L60 0')
    expect(sparkline([null, 80], 60, 24)).toBeNull()
  })
})

describe('the period on screen', () => {
  test('T-SPC-UNIT-PROG-11 starts on Monday for a week and on the 1st for a month', () => {
    expect(periodStart('2026-10-25', 'week')).toBe('2026-10-19')
    expect(periodStart('2026-10-19', 'week')).toBe('2026-10-19')
    expect(periodStart('2026-10-25', 'month')).toBe('2026-10-01')
  })
})

describe('an earlier period', () => {
  test('T-SPC-UNIT-PROG-13 each movement reads its best in that period against the one before it', () => {
    const [squat] = movementsAt([movement('Sentadilla', [80, null, 85, 92.5])], 2)
    expect(squat).toMatchObject({ best_kg: 85, previous_best_kg: 80, change_kg: 5 })
    expect(movementsAt([movement('Curl', [12, null, null, 14])], 1)).toEqual([])
  })
})

describe('the period before', () => {
  test('T-SPC-UNIT-PROG-14 is the Monday before, or the 1st of the month before', () => {
    expect(previousStart('2026-10-19', 'week')).toBe('2026-10-12')
    expect(previousStart('2026-10-01', 'month')).toBe('2026-09-01')
    expect(previousStart('2026-01-01', 'month')).toBe('2025-12-01')
  })
})

describe('choosing a programme', () => {
  const program = (
    assignment_id: string,
    title: string,
    planned: number[],
    fulfilled: number[],
  ) => ({
    assignment_id,
    title,
    from_gym: false,
    planned,
    fulfilled,
  })
  const programs = [
    program('a', 'Torso y pierna', [4, 4], [3, 1]),
    program('b', 'Fuerza básica', [3, 3], [2, 0]),
  ]

  test('T-SPC-UNIT-PROG-15 offers everything, each programme and free training, done of planned', () => {
    expect(programOptions(programs, [period('w1'), period('w2', { unplanned: 2 })], 1)).toEqual([
      {
        key: null,
        label: 'Todos los programas',
        caption: '2 programas y entrenos libres',
        done: 1,
        planned: 7,
      },
      { key: 'a', label: 'Torso y pierna', caption: 'Programa propio', done: 1, planned: 4 },
      { key: 'b', label: 'Fuerza básica', caption: 'Programa propio', done: 0, planned: 3 },
      { key: 'free', label: 'Libres', caption: 'Sin programa', done: 2, planned: null },
    ])
  })

  test('T-SPC-UNIT-PROG-16 with one programme and nothing free there is nothing to choose', () => {
    expect(
      programOptions([programs[0] ?? program('x', 'x', [], [])], [period('w1'), period('w2')], 1),
    ).toEqual([])
  })
})
