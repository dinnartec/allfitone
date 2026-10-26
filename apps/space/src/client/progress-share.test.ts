import { describe, expect, test } from 'bun:test'

import type { HistoryItem } from './history'
import type { Period, PeriodComparison, PeriodMovement } from './progress'
import {
  cardsFor,
  hoursAndMinutes,
  receiptRows,
  shareFacts,
  stickersFor,
  type ShareFacts,
} from './progress-share'

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

const movement = (name: string, bests: (number | null)[]): PeriodMovement => ({
  movement_id: `id-${name}`,
  name,
  best_kg: 0,
  previous_best_kg: null,
  change_kg: null,
  bests,
})

const kept = (starts_on: string) => period(starts_on, { planned: 4, fulfilled: 4, sessions: 4 })

const week: PeriodComparison = {
  period: 'week',
  programs: [],
  movements: [movement('Sentadilla', [80, 80, null, 85, 85, 92.5]), movement('Curl', [12, 12])],
  periods: [
    period('2026-09-14'),
    kept('2026-09-21'),
    kept('2026-09-28'),
    kept('2026-10-05'),
    period('2026-10-12', {
      planned: 4,
      fulfilled: 4,
      sessions: 4,
      volume_kg: 10600,
      work_sets: 32,
    }),
    period('2026-10-19', {
      sessions: 4,
      active_days: 4,
      trained_seconds: 13_200,
      work_sets: 38,
      volume_kg: 12480,
      planned: 4,
      fulfilled: 4,
      muscles: [
        { code: 'lats', name: 'Dorsal', sets: 12 },
        { code: 'delts', name: 'Hombros', sets: 10 },
        { code: 'biceps', name: 'Bíceps', sets: 8 },
        { code: 'traps', name: 'Trapecio', sets: 4 },
        { code: 'forearms', name: 'Antebrazo', sets: 4 },
      ],
      days: [
        { trained_on: '2026-10-19', volume_kg: 3600 },
        { trained_on: '2026-10-21', volume_kg: 2900 },
        { trained_on: '2026-10-23', volume_kg: 3200 },
        { trained_on: '2026-10-24', volume_kg: 2780 },
      ],
    }),
  ],
}

const month: PeriodComparison = {
  period: 'month',
  programs: [],
  movements: [],
  periods: [
    period('2026-08-01', { volume_kg: 43200 }),
    period('2026-09-01', {
      sessions: 3,
      volume_kg: 48400,
      planned: 18,
      fulfilled: 16,
      days: [
        { trained_on: '2026-09-01', volume_kg: 3000 },
        { trained_on: '2026-09-08', volume_kg: 6000 },
        { trained_on: '2026-09-30', volume_kg: null },
      ],
    }),
  ],
}

describe('the facts of a week', () => {
  const facts = shareFacts(week, 5)

  test('T-SPC-UNIT-PSH-01 names the week and says it against the one before', () => {
    expect(facts).toMatchObject({
      kicker: 'MI SEMANA · 19 – 25 OCT',
      label: '19 – 25 OCT',
      noun: 'semana',
      against: 'LA SEMANA PASADA',
      sessions: 4,
      volumeKg: 12480,
      previousKg: 10600,
      change: 18,
      duration: '3H 40',
      setsChange: 6,
    })
  })

  test('T-SPC-UNIT-PSH-02 has a bar for every day, trained or not', () => {
    expect(facts.bars.map((bar) => [bar.label, bar.kg])).toEqual([
      ['L', 3600],
      ['M', null],
      ['X', 2900],
      ['J', null],
      ['V', 3200],
      ['S', 2780],
      ['D', null],
    ])
  })

  test('T-SPC-UNIT-PSH-03 counts the weeks the plan was kept, back from this one', () => {
    expect(facts.streak).toBe(5)
    expect(facts.kept).toEqual([false, true, true, true, true, true])
  })

  test('T-SPC-UNIT-PSH-04 the load that rose most, with its trend across the weeks', () => {
    expect(facts.lift).toEqual({
      name: 'Sentadilla',
      from: 85,
      to: 92.5,
      change: 7.5,
      points: [80, 80, null, 85, 85, 92.5],
      labels: ['14 SEP', '21 SEP', '28 SEP', '5 OCT', '12 OCT', '19 OCT'],
    })
  })
})

describe('the facts of a month', () => {
  const facts = shareFacts(month, 1)

  test('T-SPC-UNIT-PSH-05 names the month and compares it with the one before by name', () => {
    expect(facts).toMatchObject({
      kicker: 'MI MES · SEPTIEMBRE 2026',
      label: 'SEPTIEMBRE 2026',
      monthName: 'SEPTIEMBRE',
      noun: 'mes',
      against: 'AGOSTO',
      change: 12,
      lift: null,
    })
  })

  test('T-SPC-UNIT-PSH-06 bars are the calendar weeks inside the month', () => {
    expect(facts.bars.map((bar) => [bar.label, bar.kg])).toEqual([
      ['1–6', 3000],
      ['7–13', 6000],
      ['14–20', null],
      ['21–27', null],
      ['28–30', 0],
    ])
  })

  test('T-SPC-UNIT-PSH-07 the calendar starts on its weekday and shades by load', () => {
    expect(facts.offset).toBe(1)
    expect(facts.cells).toHaveLength(30)
    expect(facts.cells[0]).toEqual({ day: 1, level: 2 })
    expect(facts.cells[7]).toEqual({ day: 8, level: 3 })
    expect(facts.cells[29]).toEqual({ day: 30, level: 1 })
    expect(facts.cells[1]).toEqual({ day: 2, level: 0 })
  })
})

describe('which cards and stickers appear', () => {
  test('T-SPC-UNIT-PSH-08 a week offers its own cards, the receipt only with its sessions', () => {
    expect(cardsFor(shareFacts(week, 5), true)).toEqual([
      'load',
      'receipt',
      'versus',
      'lift',
      'figure',
      'total',
      'dots',
      'muscles',
    ])
    expect(cardsFor(shareFacts(week, 5), false)).not.toContain('receipt')
  })

  test('T-SPC-UNIT-PSH-09 a card with nothing true to say does not appear', () => {
    const empty: ShareFacts = shareFacts(month, 1)
    expect(cardsFor(empty, false)).toEqual(['load', 'calendar', 'versus', 'total', 'dots'])
    expect(stickersFor(empty)).toEqual(['figures', 'change', 'calendar', 'ring', 'strip'])
  })

  test('T-SPC-UNIT-PSH-10 a week offers its stickers, the streak once it is one', () => {
    expect(stickersFor(shareFacts(week, 5))).toEqual([
      'figures',
      'change',
      'bars',
      'ring',
      'streak',
      'lift',
      'strip',
      'muscles',
    ])
  })
})

describe('words and the receipt', () => {
  test('T-SPC-UNIT-PSH-11 time reads in hours and minutes, minutes alone under an hour', () => {
    expect(hoursAndMinutes(13_200)).toBe('3H 40')
    expect(hoursAndMinutes(2_700)).toBe('45 MIN')
    expect(hoursAndMinutes(3_900)).toBe('1H 05')
  })

  test('T-SPC-UNIT-PSH-12 one line per day of the week, a rest day included', () => {
    const item = (trained_on: string, title: string | null, kg: number | null, min: number) =>
      ({
        executed_session_id: `${trained_on}-${String(title)}`,
        status: 'completed',
        started_at: `${trained_on}T18:00:00Z`,
        trained_on,
        title,
        is_free: title === null,
        discipline_code: 'strength',
        duration_seconds: min * 60,
        work_sets: 10,
        total_volume_kg: kg,
        record_count: 0,
        thumbnail_url: null,
      }) satisfies HistoryItem
    const rows = receiptRows(
      [
        item('2026-10-19', 'Torso A', 3600, 52),
        item('2026-10-21', 'Pierna A', 2900, 58),
        item('2026-10-21', null, 400, 20),
        item('2026-10-26', 'Fuera', 1000, 40),
      ],
      '2026-10-19',
    )
    expect(rows).toEqual([
      { day: 'LUN 19', title: 'TORSO A', kg: 3600, minutes: 52 },
      { day: 'MAR 20', title: null, kg: null, minutes: 0 },
      { day: 'MIÉ 21', title: '2 SESIONES', kg: 3300, minutes: 78 },
      { day: 'JUE 22', title: null, kg: null, minutes: 0 },
      { day: 'VIE 23', title: null, kg: null, minutes: 0 },
      { day: 'SÁB 24', title: null, kg: null, minutes: 0 },
      { day: 'DOM 25', title: null, kg: null, minutes: 0 },
    ])
  })
})
