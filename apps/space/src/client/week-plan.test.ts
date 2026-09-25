import { describe, expect, test } from 'bun:test'

import {
  cardsFor,
  dayChip,
  firstCardShown,
  LAST_TIME_LABEL,
  lastTimeShown,
  programDayOf,
  startLabel,
  weekDays,
  weekPlanFailure,
  type WeekPlan,
  type WeekRoutine,
} from './week-plan'

function routine(overrides: Partial<WeekRoutine> = {}): WeekRoutine {
  return {
    planned_session_id: '019e4000-0000-7000-8000-000000000401',
    template_version_id: '019e4000-0000-7000-8000-000000000501',
    title: 'Empuje',
    discipline_code: 'strength',
    status: 'scheduled',
    program_day: 1,
    scheduled_at: '2026-08-31T10:00:00Z',
    exercise_count: 5,
    set_count: 16,
    done: false,
    open_execution_id: null,
    last_time: null,
    ...overrides,
  }
}

function plan(sessions: WeekRoutine[]): WeekPlan {
  return {
    assignment_id: '019e4000-0000-7000-8000-000000000301',
    program_version_id: '019e4000-0000-7000-8000-000000000201',
    program_title: 'Torso y pierna',
    program_week: 2,
    week_starts_on: '2026-08-31',
    sessions,
  }
}

describe('which routine the screen reaches for', () => {
  test('T-SPC-UNIT-70 suggests today, or the next day that still has something pending', () => {
    // The same rule Hoy opens on, so the two screens never point at different days.
    const week = plan([
      routine({ title: 'Lunes', program_day: 1 }),
      routine({ title: 'Miércoles', program_day: 3 }),
      routine({ title: 'Viernes', program_day: 5 }),
    ])

    expect(cardsFor(week, 3).map((card) => card.state)).toEqual(['pending', 'suggested', 'pending'])
    expect(cardsFor(week, 4).map((card) => card.state)).toEqual(['pending', 'pending', 'suggested'])
  })

  test('T-SPC-UNIT-73 a day already done hands the suggestion to the next one', () => {
    const cards = cardsFor(
      plan([
        routine({ program_day: 1 }),
        routine({ program_day: 3, done: true }),
        routine({ program_day: 5 }),
      ]),
      3,
    )

    expect(cards.map((card) => card.state)).toEqual(['pending', 'done', 'suggested'])
  })

  test('T-SPC-UNIT-74 past the last session, the first one pending of the week that follows', () => {
    const cards = cardsFor(
      plan([routine({ program_day: 1 }), routine({ program_day: 3 }), routine({ program_day: 5 })]),
      6,
    )

    expect(cards.map((card) => card.state)).toEqual(['suggested', 'pending', 'pending'])
  })

  test('T-SPC-UNIT-75 two sessions on the same day suggest the first one written', () => {
    const cards = cardsFor(
      plan([
        routine({ title: 'Torso', program_day: 2 }),
        routine({ title: 'Core', program_day: 2 }),
      ]),
      2,
    )

    expect(cards.map((card) => card.state)).toEqual(['suggested', 'pending'])
  })

  test('T-SPC-UNIT-71 an attempt already open outranks the suggestion', () => {
    // Coming back to something half-done beats starting the next thing, and
    // offering the next thing would strand it.
    const cards = cardsFor(
      plan([
        routine({ title: 'Torso A' }),
        routine({ title: 'Pierna A', open_execution_id: '019e4000-0000-7000-8000-000000000501' }),
      ]),
      1,
    )

    expect(cards.map((card) => card.state)).toEqual(['pending', 'open'])
  })

  test('T-SPC-UNIT-72 a routine already done keeps its place and offers to be done again', () => {
    const cards = cardsFor(plan([routine({ done: true }), routine({ done: true })]), 1)

    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.state === 'done')).toBe(true)
  })
})

describe('what a failed week read means', () => {
  test('T-SP-WEEK-20 no programme is the catalogue, not a failure to report', () => {
    expect(weekPlanFailure('not-found')).toBe('unassigned')
  })

  test('T-SP-WEEK-21 an expired session is its own answer, because signing in fixes it', () => {
    expect(weekPlanFailure('unauthenticated')).toBe('expired')
  })

  test('T-SP-WEEK-22 anything else is a failure the person can retry', () => {
    expect(weekPlanFailure('server-error')).toBe('failed')
    expect(weekPlanFailure(undefined)).toBe('failed')
  })
})

describe('el carrusel de Hoy', () => {
  test('T-SPC-UNIT-80 el programa cuenta desde el lunes y JavaScript desde el domingo', () => {
    // Un día de diferencia es «HOY» en la tarjeta equivocada.
    expect(programDayOf(new Date('2026-08-31T12:00:00'))).toBe(1)
    expect(programDayOf(new Date('2026-09-06T12:00:00'))).toBe(7)
  })

  test('T-SPC-UNIT-81 el chip dice el día, y «HOY» cuando toca hoy', () => {
    expect(dayChip(3, 1)).toBe('MIÉRCOLES')
    expect(dayChip(1, 1)).toBe('HOY')
  })

  test('T-SPC-UNIT-82 la semana son siete días, y se ve dónde están los libres', () => {
    const days = weekDays(
      cardsFor(plan([routine({ program_day: 1, done: true }), routine({ program_day: 4 })]), 4),
      4,
    )

    expect(days).toHaveLength(7)
    expect(days.map((one) => one.planned)).toEqual([true, false, false, true, false, false, false])
    expect(days[0]?.done).toBe(true)
    expect(days[3]).toMatchObject({ planned: true, done: false, today: true })
  })

  test('T-SPC-UNIT-83 un día con una sesión a medias no está cumplido', () => {
    const days = weekDays(
      cardsFor(plan([routine({ program_day: 2, done: true }), routine({ program_day: 2 })]), 2),
      1,
    )

    expect(days[1]).toMatchObject({ planned: true, done: false })
  })

  test('T-SPC-UNIT-84 el botón no promete empezar lo que ya está empezado', () => {
    expect(startLabel('open')).toBe('Continuar')
    expect(startLabel('done')).toBe('Repetir')
    expect(startLabel('suggested')).toBe('Empezar')
    expect(startLabel('pending')).toBe('Empezar')
  })
})

describe('lastTimeShown', () => {
  const today = new Date('2026-09-20T15:00:00Z')

  test('T-SPC-UNIT-85 una rutina sin pasado no dibuja la franja', () => {
    expect(lastTimeShown(null, today)).toBeUndefined()
  })

  test('T-SPC-UNIT-86 dice a cuántos días quedó, y nombra el ayer', () => {
    const when = (trained_on: string) =>
      lastTimeShown({ trained_on, seconds: 600, sets: 4, tonnage_kg: null }, today)?.when

    // Hoy no se nombra: «la última vez, hoy» es una contradicción, y el rótulo solo
    // dice lo mismo sin ella.
    expect(when('2026-09-20')).toBe(LAST_TIME_LABEL)
    expect(when('2026-09-19')).toBe('LA ÚLTIMA VEZ, AYER')
    expect(when('2026-09-14')).toBe('LA ÚLTIMA VEZ, HACE 6 DÍAS')
  })

  test('T-SPC-UNIT-87 las tres cifras van en el orden del diseño', () => {
    const shown = lastTimeShown(
      { trained_on: '2026-09-14', seconds: 3240, sets: 16, tonnage_kg: 5120.5 },
      today,
    )

    expect(shown?.figures).toEqual([
      { value: '5,1', unit: 'TONELADAS' },
      { value: '54', unit: 'MINUTOS' },
      { value: '16', unit: 'SERIES' },
    ])
  })

  test('T-SPC-UNIT-88 debajo de una tonelada se cuenta en kilos, no en «0,5 toneladas»', () => {
    const shown = lastTimeShown(
      { trained_on: '2026-09-19', seconds: 60, sets: 1, tonnage_kg: 512.4 },
      today,
    )

    expect(shown?.figures).toEqual([
      { value: '512', unit: 'KILOS' },
      { value: '1', unit: 'MINUTO' },
      { value: '1', unit: 'SERIE' },
    ])
  })

  test('T-SPC-UNIT-89 lo que no se respondió no se dibuja, y no se dibuja como cero', () => {
    const shown = lastTimeShown(
      { trained_on: '2026-09-19', seconds: null, sets: 9, tonnage_kg: null },
      today,
    )

    expect(shown?.figures).toEqual([{ value: '9', unit: 'SERIES' }])
  })
})

describe('which card the carousel opens on', () => {
  const week = (...days: number[]) =>
    cardsFor(plan(days.map((program_day) => routine({ program_day }))), 1)

  test("today's card, wherever it sits in the week", () => {
    expect(firstCardShown(week(1, 3, 5), 3)).toBe(1)
    expect(firstCardShown(week(1, 3, 5), 5)).toBe(2)
  })

  test('on a rest day, the next day that asks for something', () => {
    expect(firstCardShown(week(1, 3, 5), 2)).toBe(1)
    expect(firstCardShown(week(1, 3, 5), 4)).toBe(2)
  })

  test('after the last session, the first one of next week', () => {
    expect(firstCardShown(week(1, 3, 5), 6)).toBe(0)
    expect(firstCardShown(week(2, 4), 7)).toBe(0)
  })

  test('it does not trust the order the week arrives in', () => {
    expect(firstCardShown(week(5, 1, 3), 2)).toBe(2)
  })

  test('two sessions on the same day open on the first of them', () => {
    expect(firstCardShown(week(1, 3, 3), 3)).toBe(1)
  })

  test('an empty week opens on nothing in particular', () => {
    expect(firstCardShown([], 3)).toBe(0)
  })
})
