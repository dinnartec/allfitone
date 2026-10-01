import { describe, expect, test } from 'bun:test'

import type { Execution, FinishedExecution, FinishedSet } from './execution'
import {
  annulConsequences,
  bestSetLine,
  changesBetween,
  clockOf,
  comparisonLine,
  deletionLine,
  editResults,
  editStateFrom,
  exercisesLine,
  menuTitle,
  revertedSet,
  setLine,
  whenRange,
  withAddedSet,
  withClock,
  withEditedSet,
} from './finished'
import { withoutSet } from './session-form'

const ZONE = 'America/Bogota'

const set = (overrides: Partial<FinishedSet>): FinishedSet => ({
  set_order: 1,
  kind: 'normal',
  load_value: 70,
  load_unit_code: 'kg',
  achieved_reps: 8,
  rpe: null,
  best_ever: false,
  ...overrides,
})

const lastTime = {
  executed_session_id: '019e4000-0000-7000-8000-000000000202',
  started_at: '2026-09-17T23:00:00.000Z',
  total_volume_kg: 3690,
  change_percent: 4,
}

const detail: FinishedExecution = {
  executed_session_id: '019e4000-0000-7000-8000-000000000201',
  revision_number: 4,
  started_at: '2026-09-29T23:02:00.000Z',
  ended_at: '2026-09-29T23:50:00.000Z',
  duration_seconds: 2880,
  title: 'Tirón',
  planned_session_id: '019e4000-0000-7000-8000-000000000101',
  repeatable: true,
  session_number: 14,
  work_sets: 12,
  total_volume_kg: 3840,
  record_count: 2,
  previous: lastTime,
  exercises: [
    {
      position: 1,
      movement_id: 'a',
      movement: 'Remo con barra',
      superset_group: null,
      record: true,
      best_set: { load_kg: 70, reps: 8 },
      sets: [set({ kind: 'warmup', load_value: 40 }), set({ set_order: 2 }), set({ set_order: 3 })],
    },
    {
      position: 2,
      movement_id: 'b',
      movement: 'Dominadas',
      superset_group: null,
      record: false,
      best_set: null,
      sets: [set({ set_order: 4, load_value: null, achieved_reps: 10 })],
    },
  ],
}

describe('what the detail of a finished session says (FIN-18)', () => {
  test('T-SPC-UNIT-192 a set is its load and its reps, as much of it as there is', () => {
    expect(setLine(set({}))).toBe('70 kg × 8')
    expect(setLine(set({ load_value: 7.5 }))).toBe('7,5 kg × 8')
    expect(setLine(set({ load_value: null, achieved_reps: 10 }))).toBe('10 reps')
    expect(setLine(set({ achieved_reps: null }))).toBe('70 kg')
    expect(setLine(set({ load_value: null, achieved_reps: null }))).toBe('—')
  })

  test('T-SPC-UNIT-193 each exercise says its best set, and nothing when none was weighed', () => {
    expect(bestSetLine({ load_kg: 70, reps: 8 })).toBe('Mejor serie 70 kg × 8')
    expect(bestSetLine(null)).toBeNull()
  })

  test('T-SPC-UNIT-194 the exercises and their work sets, a warmup not one of them', () => {
    expect(exercisesLine(detail)).toBe('2 ejercicios · 3 series')
  })

  test('T-SPC-UNIT-195 against the last time the routine was done', () => {
    expect(comparisonLine(detail.previous, ZONE)).toBe('+4 % de carga frente al 17 sep')
    const before = { ...lastTime, change_percent: -3 }
    expect(comparisonLine(before, ZONE)).toBe('−3 % de carga frente al 17 sep')
    expect(comparisonLine({ ...before, change_percent: 0 }, ZONE)).toBe(
      'La misma carga que el 17 sep',
    )
    expect(comparisonLine({ ...before, change_percent: null }, ZONE)).toBeNull()
    expect(comparisonLine(null, ZONE)).toBeNull()
  })

  test('T-SPC-UNIT-196 when it was, in the zone it was trained in', () => {
    expect(whenRange(detail, ZONE)).toBe('mar 29 sep · 18:02–18:50')
    expect(menuTitle('Tirón', detail.started_at, ZONE)).toBe('Tirón · mar 29')
  })

  test('T-SPC-UNIT-202 the warning names the day in full', () => {
    expect(deletionLine('Tirón', detail.started_at, ZONE)).toBe(
      'Tirón del martes 29 sale de tu historial y no se puede recuperar.',
    )
  })
})

describe('what annulling would change (FIN-18c)', () => {
  test('T-SPC-UNIT-197 the records that go, the streak if it moves, and the totals', () => {
    expect(annulConsequences({ records: 2, streak_weeks: 8, streak_weeks_after: 7 })).toEqual([
      { icon: 'record', text: 'Se pierden sus 2 récords' },
      { icon: 'energy', text: 'Tu racha baja de 8 a 7 semanas' },
      { icon: 'weight', text: 'Tus totales se recalculan' },
    ])
    expect(annulConsequences({ records: 1, streak_weeks: 3, streak_weeks_after: 3 })).toEqual([
      { icon: 'record', text: 'Se pierde su récord' },
      { icon: 'weight', text: 'Tus totales se recalculan' },
    ])
    expect(annulConsequences({ records: 0, streak_weeks: 1, streak_weeks_after: 0 })).toEqual([
      { icon: 'energy', text: 'Tu racha de 1 semana se pierde' },
      { icon: 'weight', text: 'Tus totales se recalculan' },
    ])
  })
})

const recorded: Execution = {
  executed_session_id: detail.executed_session_id,
  execution_status: 'completed',
  started_at: detail.started_at,
  revision_number: 4,
  title: 'Tirón',
  discipline_code: 'strength',
  program_title: null,
  week: null,
  planned: [],
  exercises: [
    {
      position: 1,
      movement_id: 'a',
      movement: 'Remo con barra',
      planned_step_id: null,
      superset_group: null,
      rest_seconds: 90,
      target: null,
      previous: [],
      sets: [
        {
          set_order: 1,
          kind: 'normal',
          target_reps: 8,
          target_load_value: null,
          target_load_unit_code: null,
        },
        {
          set_order: 2,
          kind: 'normal',
          target_reps: 8,
          target_load_value: null,
          target_load_unit_code: null,
        },
        {
          set_order: 3,
          kind: 'normal',
          target_reps: 8,
          target_load_value: null,
          target_load_unit_code: null,
        },
      ],
    },
  ],
  results: [
    {
      family: 'strength',
      set_order: 1,
      movement_id: 'a',
      achieved_reps: 8,
      load_value: 60,
      load_unit_code: 'kg',
      rpe: null,
      kind: 'normal',
      exercise_position: 1,
    },
    {
      family: 'strength',
      set_order: 2,
      movement_id: 'a',
      achieved_reps: 8,
      load_value: 65,
      load_unit_code: 'kg',
      rpe: null,
      kind: 'normal',
      exercise_position: 1,
    },
  ],
} as unknown as Execution

describe('editing a finished session (FIN-18d)', () => {
  test('T-SPC-UNIT-198 opens with what was recorded and nothing the routine only proposed', () => {
    const [remo] = editStateFrom(recorded)
    expect(remo?.sets.map((one) => [one.order, one.loadKg, one.reps, one.done])).toEqual([
      [1, '60', '8', true],
      [2, '65', '8', true],
    ])
  })

  test('T-SPC-UNIT-199 counts each change once, and an undone change is none', () => {
    const before = editStateFrom(recorded)
    const heavier = withEditedSet(before, 1, 2, { loadKg: '67,5' })
    expect(changesBetween(before, heavier, false)).toBe(1)
    expect(changesBetween(before, withAddedSet(heavier, 1), true)).toBe(3)
    expect(changesBetween(before, withoutSet(before, 1, 1), false)).toBe(1)
    const undone = withEditedSet(heavier, 1, 2, { loadKg: '65' })
    expect(changesBetween(before, undone, false)).toBe(0)
  })

  test('T-SPC-UNIT-200 a set can go back to what it was', () => {
    const before = editStateFrom(recorded)
    const heavier = withEditedSet(before, 1, 2, { loadKg: '70', reps: '6' })
    const back = revertedSet(before, heavier, 1, 2)
    expect(back[0]?.sets[1]).toMatchObject({ loadKg: '65', reps: '8' })
  })

  test('T-SPC-UNIT-201 saves what has a figure, decimals with a comma read as decimals', () => {
    const before = editStateFrom(recorded)
    const edited = withAddedSet(withEditedSet(before, 1, 2, { loadKg: '67,5' }), 1)
    const emptied = withEditedSet(edited, 1, 3, { loadKg: '', reps: '' })
    const results = editResults(emptied)
    expect(
      results.strength_sets.map((one) => [one.order, one.load?.value, one.achieved_reps]),
    ).toEqual([
      [1, 60, 8],
      [2, 67.5, 8],
    ])
  })
})

describe('the time of a finished session', () => {
  test('T-SPC-UNIT-203 a clock is set on the same local day, in the zone it was trained in', () => {
    expect(clockOf('2026-09-29T23:02:00.000Z', ZONE)).toBe('18:02')
    expect(withClock('2026-09-29T23:02:00.000Z', '17:45', ZONE)).toBe('2026-09-29T22:45:00.000Z')
    // Past midnight UTC, still the 29th in Bogotá.
    expect(withClock('2026-09-29T23:02:00.000Z', '20:10', ZONE)).toBe('2026-09-30T01:10:00.000Z')
    expect(withClock('2026-09-29T23:02:00.000Z', '7:5', ZONE)).toBeNull()
    expect(withClock('2026-09-29T23:02:00.000Z', '25:00', ZONE)).toBeNull()
  })
})
