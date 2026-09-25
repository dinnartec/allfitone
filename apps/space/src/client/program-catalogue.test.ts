import { describe, expect, test } from 'bun:test'

import {
  estimatedMinutes,
  targetLabel,
  cardsFor,
  catalogueList,
  dayFigures,
  posterCaption,
  sessionMinutes,
  totalExercises,
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
    cover_url: null,
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

/** Un día del reparto, con los objetivos que se le pasen. */
function aDay(steps: Array<Record<string, unknown>>, title = 'Día') {
  return {
    day: 1,
    title,
    discipline_code: 'strength',
    cover_url: null,
    steps: steps.map((target, index) => ({
      position: index + 1,
      movement_id: null,
      movement: null,
      target,
    })),
  }
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

describe('targetLabel', () => {
  test('reads strength as sets by reps, and as sets alone when there are none', () => {
    expect(targetLabel({ family: 'strength', target_sets: 4, target_reps: 8 })).toBe('4 × 8')
    // A plank is three sets of "as long as you can", and it has no rep count.
    expect(targetLabel({ family: 'strength', target_sets: 3 })).toBe('3 series')
  })

  test('prefers a distance over a duration when a run declares one', () => {
    expect(
      targetLabel({
        family: 'endurance',
        target_distance_value: 5,
        target_distance_unit_code: 'km',
        target_duration_seconds: 1800,
      }),
    ).toBe('5 km')
    expect(targetLabel({ family: 'endurance', target_duration_seconds: 1800 })).toBe('30 min')
  })

  test('reads intervals as rounds by work', () => {
    expect(
      targetLabel({
        family: 'interval',
        rounds: 8,
        work_duration_seconds: 40,
        rest_duration_seconds: 20,
      }),
    ).toBe('8 × 40s')
  })

  test('says nothing rather than something wrong for a shape it does not know', () => {
    expect(targetLabel({ family: 'nonsense' })).toBe('')
    expect(targetLabel({ family: 'strength' })).toBe('')
  })
})

describe('estimatedMinutes', () => {
  const day = (steps: Array<Record<string, unknown>>) => aDay(steps)

  test('adds up the sets at three minutes each, rounded to five', () => {
    expect(
      estimatedMinutes(
        day([
          { family: 'strength', target_sets: 4, target_reps: 8 },
          { family: 'strength', target_sets: 3, target_reps: 10 },
          { family: 'strength', target_sets: 3, target_reps: 12 },
        ]),
      ),
    ).toBe(30)
  })

  test('takes a run at its declared duration, and a distance at six minutes a kilometre', () => {
    expect(estimatedMinutes(day([{ family: 'endurance', target_duration_seconds: 1800 }]))).toBe(30)
    expect(estimatedMinutes(day([{ family: 'endurance', target_distance_value: 5 }]))).toBe(30)
  })

  test('counts an interval as its rounds of work plus rest', () => {
    expect(
      estimatedMinutes(
        day([
          { family: 'interval', rounds: 10, work_duration_seconds: 45, rest_duration_seconds: 15 },
        ]),
      ),
    ).toBe(10)
  })

  test('answers zero for a day with nothing measurable, so nothing is shown', () => {
    expect(estimatedMinutes(day([{ family: 'nonsense' }]))).toBe(0)
    expect(estimatedMinutes(day([]))).toBe(0)
  })
})

describe('posterCaption', () => {
  test('says the days, the length and the level, which is what the card has to show', () => {
    expect(posterCaption(program({ id: 'a', days_per_week: 3, weeks: 8 }))).toBe(
      '3 días · 8 semanas · con práctica',
    )
  })

  test('says «Sin fin» for a programme that repeats, instead of leaving the slot empty', () => {
    // Un hueco se lee como un dato que falta; «Sin fin» es la respuesta.
    expect(posterCaption(program({ id: 'a', weeks: null }))).toBe('3 días · Sin fin · con práctica')
  })

  test('drops the level rather than inventing one when the version declares none', () => {
    expect(posterCaption(program({ id: 'a', levels: [] }))).toBe('3 días · 8 semanas')
  })
})

describe('catalogueList', () => {
  const catalogue = [...band('fuerza'), ...band('salud', { goals: ['get_fit'] })]

  test('folded, it is the three frequencies and says how many are left', () => {
    const { cards, hidden } = catalogueList(catalogue, EMPTY_PROFILE, false)

    expect(cards).toHaveLength(3)
    expect(hidden).toBe(3)
  })

  test('expanded, it is the whole catalogue in this very screen', () => {
    const { cards, hidden } = catalogueList(catalogue, EMPTY_PROFILE, true)

    expect(cards).toHaveLength(6)
    expect(hidden).toBe(0)
  })

  test('puts the suggested one first, folded and open', () => {
    // Lo que se recomienda se lee primero: en orden de frecuencia podía quedar
    // segunda o tercera, y había que buscarla.
    for (const expanded of [false, true]) {
      const { cards } = catalogueList(catalogue, EMPTY_PROFILE, expanded)
      expect(cards[0]?.suggested).toBe(true)
      expect(cards.filter((card) => card.suggested)).toHaveLength(1)
    }
  })

  test('leaves the order alone when nothing is marked', () => {
    const { cards } = catalogueList([], EMPTY_PROFILE, true)

    expect(cards).toEqual([])
  })

  test('keeps the same programme marked when the list grows', () => {
    // Extenderla no puede parecer haber cambiado de recomendación.
    const folded = catalogueList(catalogue, EMPTY_PROFILE, false)
    const opened = catalogueList(catalogue, EMPTY_PROFILE, true)

    const before = folded.cards.find((card) => card.suggested)?.program.program_version_id
    const after = opened.cards.filter((card) => card.suggested)
    expect(after).toHaveLength(1)
    expect(after[0]?.program.program_version_id).toBe(before)
  })

  test('an empty catalogue hides nothing, which is not the same as hiding everything', () => {
    expect(catalogueList([], EMPTY_PROFILE, false)).toEqual({ cards: [], hidden: 0 })
  })
})

describe('sessionMinutes', () => {
  const strength = (sets: number) => aDay([{ family: 'strength', target_sets: sets }])

  test('averages the days rather than adding them up', () => {
    // Lo que se decide es cuánto cuesta una tarde, no cuántas horas suma el plan.
    expect(sessionMinutes([strength(10), strength(20)])).toBe(45)
  })

  test('leaves a day that estimates nothing out instead of counting it as zero', () => {
    expect(sessionMinutes([strength(10), aDay([])])).toBe(30)
  })

  test('answers zero when no day can be estimated, so nothing is shown', () => {
    expect(sessionMinutes([aDay([]), aDay([])])).toBe(0)
    expect(sessionMinutes([])).toBe(0)
  })
})

describe('totalExercises', () => {
  test('counts the whole split, which is what says if it is dense or light', () => {
    expect(totalExercises([aDay([{}, {}]), aDay([{}])])).toBe(3)
  })

  test('answers zero for a split with nothing in it', () => {
    expect(totalExercises([])).toBe(0)
  })
})

describe('dayFigures', () => {
  test('says the exercises and the estimate', () => {
    expect(dayFigures(aDay([{ family: 'strength', target_sets: 10 }]))).toBe('1 ej · ~30 min')
  })

  test('drops the estimate rather than writing a zero nobody can use', () => {
    expect(dayFigures(aDay([{ family: 'nonsense' }]))).toBe('1 ej')
  })
})
