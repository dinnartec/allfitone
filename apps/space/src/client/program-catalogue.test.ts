import { describe, expect, test } from 'bun:test'

import {
  applyFilter,
  cardsFor,
  filtersFor,
  programCaption,
  rankCatalogue,
  scoreProgram,
  suggestedFrequency,
  type ProgramSummary,
  type TrainingProfile,
} from './program-catalogue'

const EMPTY_PROFILE: TrainingProfile = {
  given_name: 'Ada',
  primary_training_goal: null,
  training_experience: null,
  biological_sex: null,
  focus_areas: [],
}

function program(overrides: Partial<ProgramSummary> & { id: string }): ProgramSummary {
  const { id, ...rest } = overrides
  return {
    program_version_id: id,
    program_id: id,
    title: id,
    weeks: 8,
    days_per_week: 3,
    sex_affinity: null,
    goals: ['build_muscle'],
    levels: ['some_practice'],
    emphases: [],
    ...rest,
  }
}

/** A band-family in the catalogue's shape: the same goal and level at three frequencies. */
function band(prefix: string, overrides: Partial<ProgramSummary> = {}): ProgramSummary[] {
  return [3, 4, 5].map((days) =>
    program({
      id: `${prefix}${days}`,
      title: `${prefix} ${days}`,
      days_per_week: days,
      ...overrides,
    }),
  )
}

describe('scoreProgram', () => {
  const matching: TrainingProfile = {
    given_name: 'Ada',
    primary_training_goal: 'build_muscle',
    training_experience: 'some_practice',
    biological_sex: 'female',
    focus_areas: ['glutes', 'legs'],
  }

  test('the goal weighs more than everything else it competes with', () => {
    const onGoal = program({ id: 'a', goals: ['build_muscle'], levels: ['starting'] })
    const onLevelAndZones = program({
      id: 'b',
      goals: ['run_a_race'],
      levels: ['some_practice'],
      emphases: ['glutes'],
    })

    expect(scoreProgram(onGoal, matching)).toBeGreaterThan(scoreProgram(onLevelAndZones, matching))
  })

  test('every term simply drops out when the answer is absent', () => {
    expect(scoreProgram(program({ id: 'a' }), EMPTY_PROFILE)).toBe(0)
  })

  test('the affinity nudges and never decides', () => {
    const leaning = program({ id: 'a', goals: ['run_a_race'], sex_affinity: 'female' })
    const onGoal = program({ id: 'b', goals: ['build_muscle'] })

    expect(scoreProgram(onGoal, matching)).toBeGreaterThan(scoreProgram(leaning, matching))
  })
})

describe('suggestedFrequency', () => {
  test('more experience, more days', () => {
    expect(suggestedFrequency('starting')).toBe(3)
    expect(suggestedFrequency('some_practice')).toBe(4)
    expect(suggestedFrequency('experienced')).toBe(5)
  })

  test('unknown experience lands on the middle, which most people can hold to', () => {
    expect(suggestedFrequency(null)).toBe(4)
  })
})

describe('cardsFor', () => {
  const catalogue = [
    ...band('musculo', { goals: ['build_muscle'], levels: ['some_practice', 'experienced'] }),
    ...band('empieza', { goals: ['build_muscle'], levels: ['starting'] }),
    ...band('correr', { goals: ['run_a_race'], levels: ['starting'] }),
  ]

  test('offers three, four and five days, in that order', () => {
    const cards = cardsFor(catalogue, {
      ...EMPTY_PROFILE,
      primary_training_goal: 'build_muscle',
      training_experience: 'some_practice',
    })

    expect(cards.map((card) => card.program.days_per_week)).toEqual([3, 4, 5])
  })

  test('keeps the person in their own band at every frequency', () => {
    // The defect this whole shape exists to prevent: somebody starting who can train
    // five days must not be handed the content written for somebody advanced.
    const cards = cardsFor(catalogue, {
      ...EMPTY_PROFILE,
      primary_training_goal: 'build_muscle',
      training_experience: 'starting',
    })

    expect(cards.map((card) => card.program.program_version_id)).toEqual([
      'empieza3',
      'empieza4',
      'empieza5',
    ])
  })

  test('marks exactly one card, and it is the one the level asks for', () => {
    const cards = cardsFor(catalogue, {
      ...EMPTY_PROFILE,
      primary_training_goal: 'build_muscle',
      training_experience: 'experienced',
    })

    expect(cards.filter((card) => card.suggested)).toHaveLength(1)
    expect(cards.find((card) => card.suggested)?.program.days_per_week).toBe(5)
  })

  test('still offers three frequencies when nothing was answered', () => {
    const cards = cardsFor(catalogue, EMPTY_PROFILE)

    expect(cards.map((card) => card.program.days_per_week)).toEqual([3, 4, 5])
    expect(cards.filter((card) => card.suggested)).toHaveLength(1)
  })

  test('leaves a frequency out rather than filling it from another band', () => {
    const cards = cardsFor(
      [program({ id: 'only3', days_per_week: 3 }), program({ id: 'only5', days_per_week: 5 })],
      EMPTY_PROFILE,
    )

    expect(cards.map((card) => card.program.days_per_week)).toEqual([3, 5])
    expect(cards.filter((card) => card.suggested)).toHaveLength(1)
  })

  test('answers nothing when the catalogue is empty', () => {
    expect(cardsFor([], EMPTY_PROFILE)).toEqual([])
  })
})

describe('rankCatalogue', () => {
  test('puts the best match first and stays stable below it', () => {
    const ranked = rankCatalogue(
      [
        program({ id: 'c', title: 'Correr', goals: ['run_a_race'], days_per_week: 5 }),
        program({ id: 'a', title: 'Ideal', goals: ['build_muscle'], levels: ['starting'] }),
        program({ id: 'b', title: 'Otro', goals: ['build_muscle'], levels: ['starting'] }),
      ],
      { ...EMPTY_PROFILE, primary_training_goal: 'build_muscle', training_experience: 'starting' },
    )

    expect(ranked.map((entry) => entry.program_version_id)).toEqual(['a', 'b', 'c'])
  })

  test('does not mutate what it was given', () => {
    const catalogue = [program({ id: 'a' }), program({ id: 'b' })]
    rankCatalogue(catalogue, EMPTY_PROFILE)

    expect(catalogue.map((entry) => entry.program_version_id)).toEqual(['a', 'b'])
  })
})

describe('programCaption', () => {
  test('describes a program by where it starts, not by everything it serves', () => {
    expect(
      programCaption(
        program({ id: 'a', days_per_week: 5, levels: ['some_practice', 'experienced'] }),
      ),
    ).toBe('5 días · con práctica')
  })

  test('says the days alone when no level is declared', () => {
    expect(programCaption(program({ id: 'a', days_per_week: 4, levels: [] }))).toBe('4 días')
  })
})

describe('filtersFor', () => {
  test('offers only the frequencies the catalogue actually publishes', () => {
    const filters = filtersFor([
      program({ id: 'a', days_per_week: 3 }),
      program({ id: 'b', days_per_week: 5 }),
      program({ id: 'c', days_per_week: 3 }),
    ])

    expect(filters.map((filter) => filter.key)).toEqual(['suggested', 'all', 'days:3', 'days:5'])
    expect(filters.map((filter) => filter.label)).toEqual([
      'Sugeridos',
      'Todos',
      '3 días',
      '5 días',
    ])
  })

  test('still offers the two that need no catalogue', () => {
    expect(filtersFor([]).map((filter) => filter.key)).toEqual(['suggested', 'all'])
  })
})

describe('applyFilter', () => {
  const catalogue = [
    ...band('musculo', { goals: ['build_muscle'], levels: ['some_practice'] }),
    ...band('correr', { goals: ['run_a_race'], levels: ['starting'] }),
  ]
  const profile: TrainingProfile = {
    ...EMPTY_PROFILE,
    primary_training_goal: 'build_muscle',
    training_experience: 'some_practice',
  }

  test('suggested is exactly what the first screen offers, so the two cannot disagree', () => {
    expect(
      applyFilter('suggested', catalogue, profile).map((entry) => entry.program_version_id),
    ).toEqual(cardsFor(catalogue, profile).map((card) => card.program.program_version_id))
  })

  test('all shows the whole catalogue, best match first', () => {
    const all = applyFilter('all', catalogue, profile)

    expect(all).toHaveLength(catalogue.length)
    expect(all[0]?.program_version_id.startsWith('musculo')).toBe(true)
  })

  test('a frequency keeps only that frequency, across every band', () => {
    const five = applyFilter('days:5', catalogue, profile)

    expect(five.map((entry) => entry.days_per_week)).toEqual([5, 5])
  })

  test('an unknown filter shows everything rather than nothing', () => {
    expect(applyFilter('days:nonsense', catalogue, profile)).toHaveLength(catalogue.length)
  })
})
