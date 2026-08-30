import { describe, expect, it } from 'bun:test'

import { weekFromToday } from './week'

describe('weekFromToday', () => {
  it('starts today and runs six days on', () => {
    // A Saturday, which is the day the approved design shows.
    const week = weekFromToday(new Date(2026, 7, 29))

    expect(week).toHaveLength(7)
    expect(week.map((day) => day.today)).toEqual([true, false, false, false, false, false, false])
    expect(week.map((day) => day.letter)).toEqual(['S', 'D', 'L', 'M', 'M', 'J', 'V'])
  })

  it('rolls over the end of a month', () => {
    const week = weekFromToday(new Date(2026, 7, 30))

    expect(week.map((day) => day.key)).toEqual([
      '2026-8-30',
      '2026-8-31',
      '2026-9-1',
      '2026-9-2',
      '2026-9-3',
      '2026-9-4',
      '2026-9-5',
    ])
  })

  it('rolls over the end of a year', () => {
    const week = weekFromToday(new Date(2026, 11, 30))

    expect(week.at(0)?.key).toBe('2026-12-30')
    expect(week.at(-1)?.key).toBe('2027-1-5')
  })

  it('gives every day a distinct key even where the letters repeat', () => {
    const week = weekFromToday(new Date(2026, 7, 29))
    const letters = week.map((day) => day.letter)
    const keys = new Set(week.map((day) => day.key))

    // Martes and miércoles share `M`, so the letter cannot be the key.
    expect(letters.filter((letter) => letter === 'M')).toHaveLength(2)
    expect(keys.size).toBe(7)
  })
})
