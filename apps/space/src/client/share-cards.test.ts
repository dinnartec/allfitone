import { describe, expect, test } from 'bun:test'

import {
  bandFigureSize,
  cardScale,
  cardsFor,
  daysSince,
  durationLabel,
  exerciseShape,
  exercisesLabel,
  groupsTitle,
  headline,
  recordFigure,
  recordJump,
  restoreLabel,
  routineTitle,
  recordGain,
  shortDay,
  stickersFor,
  minutesLine,
  storyRoute,
  streakSteps,
  weekStartLabel,
  shareSubtitle,
  workedMuscles,
  whenLine,
  type ShareSummary,
} from './share-cards'

const summary: ShareSummary = {
  executed_session_id: '019e4000-0000-7000-8000-000000000201',
  started_at: '2026-09-29T17:00:00.000Z',
  ended_at: '2026-09-29T17:48:12.000Z',
  duration_seconds: 2892,
  title: 'Tirón',
  work_sets: 12,
  exercise_count: 4,
  total_volume_kg: 3840,
  exercises: [
    {
      position: 1,
      movement_id: 'pull',
      movement: 'Dominadas lastradas',
      work_sets: 4,
      reps_min: 6,
      reps_max: 6,
    },
    {
      position: 2,
      movement_id: 'row',
      movement: 'Remo con barra',
      work_sets: 4,
      reps_min: 8,
      reps_max: 10,
    },
    {
      position: 3,
      movement_id: 'curl',
      movement: 'Curl de bíceps',
      work_sets: 3,
      reps_min: null,
      reps_max: null,
    },
  ],
  records: [
    {
      movement_id: 'row',
      movement: 'Remo con barra',
      kind: 'e1rm',
      value: 84,
      reps: null,
      previous_value: 80,
      previous_on: '2026-09-15',
    },
    {
      movement_id: 'pull',
      movement: 'Dominadas lastradas',
      kind: 'heaviest',
      value: 10,
      reps: 6,
      previous_value: 7.5,
      previous_on: '2026-09-17',
    },
  ],
  streak_weeks: 8,
  session_number: 14,
  given_name: 'Walberto',
  username: 'walberto',
  cover_url: 'https://media.example/back.webp',
  algorithm_version: 1,
}

const catalogue = {
  movements: [
    { id: 'pull', muscles: ['lats', 'biceps'] },
    { id: 'row', muscles: ['lats', 'traps'] },
    { id: 'curl', muscles: ['biceps', 'forearms'] },
  ],
  muscles: [
    { code: 'lats', name: 'Dorsal', body_slug: 'upper-back' },
    { code: 'traps', name: 'Trapecio', body_slug: 'trapezius' },
    { code: 'biceps', name: 'Bíceps', body_slug: 'biceps' },
    { code: 'forearms', name: 'Antebrazo', body_slug: 'forearm' },
  ],
}

describe('which cards a finished session shares (ADR-036)', () => {
  test('T-SPC-UNIT-151 the photograph leads, then a record and a streak when there are, then the rest', () => {
    expect(cardsFor(summary)).toEqual([
      'photo',
      'record',
      'streak',
      'session',
      'muscles',
      'number',
      'plain',
      'total',
      'time',
      'records',
      'sets',
    ])
  })

  test('T-SPC-UNIT-152 no record is no record card, and a streak of one week is no streak', () => {
    expect(cardsFor({ ...summary, records: [], streak_weeks: 1, total_volume_kg: null })).toEqual([
      'photo',
      'session',
      'muscles',
      'number',
      'plain',
      'time',
      'sets',
    ])
  })
})

describe('what the share screen and its cards say', () => {
  test('T-SPC-UNIT-153 the subtitle names the routine, the session and the records', () => {
    expect(shareSubtitle(summary)).toBe('Tirón · sesión 14 · 2 récords')
    expect(shareSubtitle({ ...summary, records: summary.records.slice(0, 1) })).toBe(
      'Tirón · sesión 14 · 1 récord',
    )
    expect(shareSubtitle({ ...summary, title: null, records: [] })).toBe('Sesión 14')
  })

  test("T-SPC-UNIT-154 the day and the number, in the person's zone", () => {
    // 17:00 UTC on the 29th is noon in Bogotá, a Tuesday.
    expect(whenLine(summary, 'America/Bogota')).toBe('MAR 29 · SESIÓN 14')
  })

  test('T-SPC-UNIT-155 the duration reads as a clock', () => {
    expect(durationLabel(2892)).toBe('48:12')
    expect(durationLabel(3725)).toBe('1:02:05')
  })

  test('T-SPC-UNIT-156 an exercise shows its sets by its reps, a range when they varied', () => {
    expect(summary.exercises.map(exerciseShape)).toEqual(['4×6', '4×8–10', '3 series'])
  })

  test('T-SPC-UNIT-157 the title is the two most worked muscle groups, or the routine', () => {
    expect(groupsTitle(summary, catalogue)).toBe('DORSAL Y BÍCEPS')
    expect(groupsTitle({ ...summary, exercises: [] }, catalogue)).toBe('TIRÓN')
  })

  test('T-SPC-UNIT-158 the muscles card lists every muscle worked, main ones first', () => {
    expect(workedMuscles(summary, catalogue).map((muscle) => muscle.name)).toEqual([
      'Dorsal',
      'Bíceps',
      'Trapecio',
      'Antebrazo',
    ])
  })
})

/** The heaviest record of the fixture, or a failure that says why there is none. */
function heaviestRecord() {
  const found = summary.records.find((record) => record.kind === 'heaviest')
  if (!found) throw new Error('the fixture has no heaviest record')
  return found
}

describe('the record card', () => {
  test('T-SPC-UNIT-159 the heaviest leads when there is one, whatever came first', () => {
    expect(headline(summary.records)?.kind).toBe('heaviest')
  })

  test('T-SPC-UNIT-160 each kind of record reads as what it is', () => {
    const [e1rm] = summary.records
    expect(recordFigure(heaviestRecord())).toEqual({
      big: '10',
      unit: 'KG',
      tail: '× 6',
      label: 'PESO MÁXIMO',
    })
    expect(e1rm && recordFigure(e1rm)).toEqual({
      big: '84',
      unit: 'KG',
      tail: '1RM',
      label: 'MEJOR 1RM ESTIMADO',
    })
    expect(recordFigure({ ...heaviestRecord(), kind: 'best_set', value: 720, reps: null })).toEqual(
      {
        big: '720',
        unit: 'KG',
        tail: 'en una serie',
        label: 'MEJOR SERIE',
      },
    )
    expect(
      recordFigure({ ...heaviestRecord(), kind: 'session_volume', value: 1345.5, reps: null }),
    ).toEqual({ big: '1.345,5', unit: 'KG', tail: 'en la sesión', label: 'MÁS VOLUMEN' })
  })
})

describe('the share screen carousel', () => {
  test('T-SPC-UNIT-163 a card is as wide as the design on its phone, and never taller than the room', () => {
    // The design's phone: 390 wide, a 300-point card.
    expect(cardScale(390, 1000)).toBeCloseTo(1)
    expect(cardScale(430, 1000)).toBeCloseTo(430 / 390)
    // A short phone gives the card the height it has, not the width it could take.
    expect(cardScale(390, 400)).toBeCloseTo(400 / 533)
  })
})

describe('the anatomical plate and the record bars', () => {
  test('T-SPC-UNIT-165 each muscle carries the sets that worked it, main and helping apart', () => {
    expect(workedMuscles(summary, catalogue).map((muscle) => [muscle.name, muscle.sets])).toEqual([
      ['Dorsal', 8],
      ['Bíceps', 3],
      ['Trapecio', 4],
      ['Antebrazo', 3],
    ])
  })

  test('T-SPC-UNIT-166 a record is told as the jump: before, now, by how much, to scale', () => {
    expect(recordJump(heaviestRecord())).toEqual({
      before: '7,5',
      now: '10',
      delta: '+2,5',
      ratio: 0.75,
    })
  })

  test('T-SPC-UNIT-167 the figures of one band share a size, set by the longest', () => {
    expect(bandFigureSize(['48:12', '12', '4', '3.840'])).toBe(30)
    expect(bandFigureSize(['1:02:05', '12', '4', '3.840'])).toBe(24)
    expect(bandFigureSize(['47:13:48', '10', '5', '880'])).toBe(20)
  })

  test('T-SPC-UNIT-168 a record day reads short, as the bars label it', () => {
    expect(shortDay('2026-09-17')).toBe('17 SEP')
  })
})

describe('the record row under the bars', () => {
  test('T-SPC-UNIT-169 the days since the earlier best, counted in calendar days', () => {
    const heaviest = heaviestRecord()
    expect(daysSince(heaviest, '2026-09-29')).toBe(12)
    expect(daysSince({ ...heaviest, previous_on: '2026-09-29' }, '2026-09-29')).toBe(0)
  })

  test('T-SPC-UNIT-170 the header names the routine; the muscles are for the card itself', () => {
    expect(routineTitle(summary, catalogue)).toBe('TIRÓN')
    expect(routineTitle({ ...summary, title: null }, catalogue)).toBe('DORSAL Y BÍCEPS')
  })
})

test('T-SPC-UNIT-171 one exercise is «1 ejercicio», not «1 ejercicios»', () => {
  expect(exercisesLabel(1)).toBe('1 ejercicio')
  expect(exercisesLabel(5)).toBe('5 ejercicios')
})

test('T-SPC-UNIT-172 Historias goes straight to Instagram only with an app id and the app', () => {
  expect(storyRoute('123', true)).toBe('instagram')
  expect(storyRoute('123', false)).toBe('sheet')
  expect(storyRoute(undefined, true)).toBe('sheet')
  expect(storyRoute('  ', true)).toBe('sheet')
})

test('T-SPC-UNIT-173 undoing a picked background says what comes back', () => {
  expect(restoreLabel('https://media.example/back.webp')).toBe('Volver a la foto de la rutina')
  expect(restoreLabel(null)).toBe('Quitar mi foto')
})

describe('the streak as steps', () => {
  test('T-SPC-UNIT-174 at most five weeks are drawn, the last ones, numbered as they were', () => {
    expect(streakSteps(2)).toEqual({ first: 1, shown: 2 })
    expect(streakSteps(5)).toEqual({ first: 1, shown: 5 })
    expect(streakSteps(8)).toEqual({ first: 4, shown: 5 })
  })

  test("T-SPC-UNIT-175 a week is named by its Monday, in the person's zone", () => {
    // 17:00 UTC on Tuesday the 29th is noon in Bogotá: that week began Monday the 28th.
    expect(weekStartLabel(summary, 'America/Bogota', 0)).toBe('EL 28 DE SEPTIEMBRE')
    expect(weekStartLabel(summary, 'America/Bogota', 7)).toBe('EL 10 DE AGOSTO')
  })
})

describe('the minimal cards and the stickers', () => {
  test('T-SPC-UNIT-176 a sticker with nothing true to say does not appear', () => {
    expect(stickersFor(summary)).toEqual([
      'figures',
      'record',
      'streak',
      'strip',
      'muscles',
      'number',
    ])
    expect(stickersFor({ ...summary, records: [], streak_weeks: 1 })).toEqual([
      'figures',
      'strip',
      'muscles',
      'number',
    ])
  })

  test('T-SPC-UNIT-177 a record reads as the gain and what it means', () => {
    const [estimated, heaviest] = summary.records
    expect(heaviest && recordGain(heaviest)).toEqual({
      gain: '+2,5 KG',
      meaning: 'MÁS PESO QUE NUNCA',
    })
    expect(estimated && recordGain(estimated)).toEqual({
      gain: '+4 KG',
      meaning: 'TU MEJOR 1RM ESTIMADO',
    })
  })

  test('T-SPC-UNIT-178 the time reads in minutes, in hours past one', () => {
    expect(minutesLine(1565)).toBe('EN 26 MINUTOS')
    expect(minutesLine(45)).toBe('EN 1 MINUTO')
    expect(minutesLine(3900)).toBe('EN 1 H 05')
  })
})
