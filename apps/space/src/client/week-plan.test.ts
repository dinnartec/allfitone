import { describe, expect, test } from 'bun:test'

import {
  cardsFor,
  dayChip,
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
  test('T-SPC-UNIT-70 suggests the first one still pending, in the order written', () => {
    const cards = cardsFor(
      plan([
        routine({ title: 'Torso A', done: true }),
        routine({ title: 'Pierna A' }),
        routine({ title: 'Torso B' }),
      ]),
    )

    expect(cards.map((card) => card.state)).toEqual(['done', 'suggested', 'pending'])
  })

  test('T-SPC-UNIT-71 an attempt already open outranks the suggestion', () => {
    // Coming back to something half-done beats starting the next thing, and
    // offering the next thing would strand it.
    const cards = cardsFor(
      plan([
        routine({ title: 'Torso A' }),
        routine({ title: 'Pierna A', open_execution_id: '019e4000-0000-7000-8000-000000000501' }),
      ]),
    )

    expect(cards.map((card) => card.state)).toEqual(['pending', 'open'])
  })

  test('T-SPC-UNIT-72 a routine already done keeps its place and offers to be done again', () => {
    const cards = cardsFor(plan([routine({ done: true }), routine({ done: true })]))

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
      cardsFor(plan([routine({ program_day: 1, done: true }), routine({ program_day: 4 })])),
      4,
    )

    expect(days).toHaveLength(7)
    expect(days.map((one) => one.planned)).toEqual([true, false, false, true, false, false, false])
    expect(days[0]?.done).toBe(true)
    expect(days[3]).toMatchObject({ planned: true, done: false, today: true })
  })

  test('T-SPC-UNIT-83 un día con una sesión a medias no está cumplido', () => {
    const days = weekDays(
      cardsFor(plan([routine({ program_day: 2, done: true }), routine({ program_day: 2 })])),
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
