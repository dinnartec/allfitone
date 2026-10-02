import { describe, expect, test } from 'bun:test'

import {
  dayParts,
  historyPath,
  historyDetail,
  dayLabel,
  daysTrainedUnit,
  monthGrid,
  longestStreak,
  monthCalendar,
  monthName,
  recordsLine,
  weekGroups,
  weekTally,
  type HistoryItem,
} from './history'

const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
  executed_session_id: '019e4000-0000-7000-8000-000000000201',
  status: 'completed',
  started_at: '2026-08-26T22:00:00.000Z',
  trained_on: '2026-08-26',
  title: 'Pierna',
  is_free: false,
  discipline_code: 'strength',
  duration_seconds: 3660,
  work_sets: 18,
  total_volume_kg: 6240,
  record_count: 0,
  thumbnail_url: null,
  ...overrides,
})

describe('the history, grouped by week (H-2, H-6)', () => {
  test('T-SPC-UNIT-176 this week, last week, two weeks ago, then the range', () => {
    // Wednesday the 26th: its week began Monday the 24th.
    const groups = weekGroups(
      [
        item({ executed_session_id: 'a', trained_on: '2026-08-26' }),
        item({ executed_session_id: 'b', trained_on: '2026-08-24' }),
        item({ executed_session_id: 'c', trained_on: '2026-08-22' }),
        item({ executed_session_id: 'd', trained_on: '2026-08-14' }),
        item({ executed_session_id: 'e', trained_on: '2026-08-02' }),
      ],
      '2026-08-26',
    )

    expect(
      groups.map((group) => [group.label, group.items.map((row) => row.executed_session_id)]),
    ).toEqual([
      ['ESTA SEMANA', ['a', 'b']],
      ['SEMANA PASADA', ['c']],
      ['HACE DOS SEMANAS', ['d']],
      ['27 JUL – 2 AGO', ['e']],
    ])
    expect(groups[3]?.weekStartsOn).toBe('2026-07-27')
  })

  test('T-SPC-UNIT-177 a range inside one month says the month once', () => {
    const [group] = weekGroups([item({ trained_on: '2026-08-19' })], '2026-09-30')
    expect(group?.label).toBe('17 – 23 AGO')
  })
})

describe('what a history row says', () => {
  test('T-SPC-UNIT-178 minutes, work sets and kilos, each only when there is one', () => {
    expect(historyDetail(item({}))).toBe('61 min · 18 series · 6.240 kg')
    expect(historyDetail(item({ total_volume_kg: null }))).toBe('61 min · 18 series')
    expect(historyDetail(item({ work_sets: 1, total_volume_kg: null }))).toBe('61 min · 1 serie')
    expect(
      historyDetail(
        item({
          is_free: true,
          title: null,
          duration_seconds: 2100,
          work_sets: 9,
          total_volume_kg: null,
        }),
      ),
    ).toBe('Entreno libre · 35 min · 9 series')
  })

  test('T-SPC-UNIT-179 records are news, so they say so', () => {
    expect(recordsLine(0)).toBeNull()
    expect(recordsLine(1)).toBe('1 récord nuevo')
    expect(recordsLine(2)).toBe('2 récords nuevos')
  })

  test('T-SPC-UNIT-180 the day on the right, short weekday over the number', () => {
    expect(dayParts('2026-08-26')).toEqual({ weekday: 'MIÉ', day: '26' })
  })
})

describe('how a week and a month read', () => {
  test('T-SPC-UNIT-181 the plan done of the plan, and whatever else apart', () => {
    const week = { week_starts_on: '2026-09-28' }
    expect(weekTally({ ...week, completed: 2, planned: 3, fulfilled: 2 })).toBe('2 de 3')
    // The same planned session done four times is one of the plan and three extra.
    expect(weekTally({ ...week, completed: 4, planned: 4, fulfilled: 1 })).toBe('1 de 4 · +3 extra')
    // Nothing planned is not «0 de 0»: it is just how many.
    expect(weekTally({ ...week, completed: 2, planned: 0, fulfilled: 0 })).toBe('2 entrenos')
    expect(weekTally({ ...week, completed: 1, planned: 0, fulfilled: 0 })).toBe('1 entreno')
  })

  test('T-SPC-UNIT-182 a month by its name', () => {
    expect(monthName('2026-08-01')).toBe('Agosto')
  })
})

describe('what the history asks the server', () => {
  test('T-SPC-UNIT-183 only the filters that are on, the text trimmed and encoded', () => {
    expect(historyPath({ timezone: 'America/Bogota' })).toBe(
      '/space/v1/executions?timezone=America%2FBogota',
    )
    expect(
      historyPath({
        timezone: 'America/Bogota',
        month: '2026-08-01',
        discipline: 'strength',
        withRecord: true,
        free: false,
        query: '  remo con barra ',
        cursor: 'abc=',
        limit: 4,
        day: '2026-08-07',
      }),
    ).toBe(
      '/space/v1/executions?timezone=America%2FBogota&month=2026-08-01&day=2026-08-07&discipline=strength&with_record=true&free=false&q=remo+con+barra&cursor=abc%3D&limit=4',
    )
  })
})

const day = (trained_on: string, work_sets: number, records = 0) => ({
  trained_on,
  sessions: 1,
  trained_seconds: 3000,
  work_sets,
  volume_kg: null,
  records,
})

describe('the month card', () => {
  test('T-SPC-UNIT-184 a Monday-first calendar marking the days trained and their records', () => {
    // September 2026 begins on a Tuesday, so the first row opens with a blank.
    const weeks = monthCalendar(
      '2026-09-01',
      [day('2026-09-01', 12), day('2026-09-03', 0, 2), day('2026-09-30', 6)],
      '2026-09-03',
    )

    expect(weeks).toHaveLength(5)
    expect(weeks[0]?.[0]).toBeNull()
    expect(weeks[0]?.[1]).toEqual({
      date: '2026-09-01',
      day: 1,
      trained: true,
      record: false,
      today: false,
    })
    // A day with no sets still counts as trained.
    expect(weeks[0]?.[3]).toEqual({
      date: '2026-09-03',
      day: 3,
      trained: true,
      record: true,
      today: true,
    })
    expect(weeks[0]?.[2]?.trained).toBe(false)
    expect(weeks[4]?.[2]?.trained).toBe(true)
    expect(weeks[4]?.slice(3)).toEqual([null, null, null, null])
  })

  test('T-SPC-UNIT-186 the card counts days, the same thing its calendar marks', () => {
    expect(daysTrainedUnit(1)).toBe('Día entrenado')
    expect(daysTrainedUnit(4)).toBe('Días entrenados')
    expect(daysTrainedUnit(0)).toBe('Días entrenados')
  })

  test('T-SPC-UNIT-185 the longest run of days in a row', () => {
    expect(longestStreak([])).toBe(0)
    expect(
      longestStreak([
        day('2026-09-01', 1),
        day('2026-09-03', 1),
        day('2026-09-04', 1),
        day('2026-09-05', 1),
        day('2026-09-08', 1),
      ]),
    ).toBe(3)
  })
})

describe('picking a day and a month', () => {
  test('T-SPC-UNIT-187 a picked day names itself the way the rows do', () => {
    expect(dayLabel('2026-09-30')).toBe('MIÉ 30 SEP')
  })

  test('T-SPC-UNIT-188 a year as twelve months, only those trained in to be picked', () => {
    const available = ['2026-10-01', '2026-09-01', '2025-11-01']
    const grid = monthGrid(2026, available, '2026-10-01')

    expect(grid.months).toHaveLength(12)
    expect(grid.months[8]).toEqual({
      month: '2026-09-01',
      label: 'Sep',
      available: true,
      current: false,
    })
    expect(grid.months[9]).toEqual({
      month: '2026-10-01',
      label: 'Oct',
      available: true,
      current: true,
    })
    expect(grid.months[0]?.available).toBe(false)
    // The arrows stop where there is nothing left to see.
    expect(grid.previous).toBe(2025)
    expect(grid.next).toBeNull()
    expect(monthGrid(2025, available, '2026-10-01').previous).toBeNull()
  })
})
