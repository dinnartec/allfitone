import { describe, expect, test } from 'bun:test'

import {
  canSubmitExperience,
  chooseLevel,
  EXPERIENCE_LEVELS,
  experienceStops,
  levelDefinition,
  NOT_A_LABEL_BODY,
  NOT_A_LABEL_TITLE,
  PICK_A_LEVEL,
  readLevel,
  TRAINING_EXPERIENCE,
  type TrainingExperience,
} from './experience-form'

describe('EXPERIENCE_LEVELS', () => {
  test('offers the three simple terms the story names', () => {
    expect(TRAINING_EXPERIENCE).toEqual(['starting', 'some_practice', 'experienced'])
    expect(EXPERIENCE_LEVELS).toHaveLength(3)
  })

  test('never uses the gym vocabulary', () => {
    // "Advanced" makes people underrate themselves and pick below their level, and
    // then the plan bores them. The words carry no rank; el recorrido lo lleva.
    const words = EXPERIENCE_LEVELS.map((entry) => entry.name.toLowerCase()).join(' ')

    for (const banned of ['principiante', 'intermedio', 'avanzado']) {
      expect(words).not.toContain(banned)
    }
  })

  test('is the only place order is stated, least to most', () => {
    expect(EXPERIENCE_LEVELS.map((entry) => entry.level)).toEqual([...TRAINING_EXPERIENCE])
  })

  test('every level says what changes in the plan, and each says something different', () => {
    const emphases = EXPERIENCE_LEVELS.map((entry) => entry.outcome.emphasis)

    expect(new Set(emphases).size).toBe(EXPERIENCE_LEVELS.length)
    for (const entry of EXPERIENCE_LEVELS) {
      expect(entry.outcome.before.length).toBeGreaterThan(0)
      expect(entry.outcome.after.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  test('the notice is one sentence about labels and one about the loads moving', () => {
    expect(NOT_A_LABEL_TITLE).toContain('etiqueta')
    expect(NOT_A_LABEL_BODY).toContain('primera semana')
  })

  test('the lede asks for an answer before it explains why', () => {
    // Sin el «marca» delante, tres círculos huecos se leen como una explicación.
    expect(PICK_A_LEVEL.startsWith('Marca')).toBe(true)
    expect(PICK_A_LEVEL).toContain('principiante')
  })
})

describe('levelDefinition', () => {
  test('answers the definition of a level', () => {
    expect(levelDefinition('some_practice')?.name).toBe('Tengo algo de práctica')
  })

  test('answers nothing for a code it cannot draw rather than throwing', () => {
    expect(levelDefinition('advanced' as never)).toBeUndefined()
  })
})

describe('chooseLevel', () => {
  test('chooses a level when nothing was chosen', () => {
    expect(chooseLevel(undefined, 'starting')).toBe('starting')
  })

  test('replaces the previous choice, because only one level can be true', () => {
    expect(chooseLevel('starting', 'experienced')).toBe('experienced')
  })

  test('tapping the chosen level again keeps it', () => {
    // Unchoosing would leave a state the screen has no answer for: "no level" is not
    // something this question offers, unlike declining the sex.
    expect(chooseLevel('experienced', 'experienced')).toBe('experienced')
  })
})

describe('experienceStops', () => {
  test('marks the chosen stop and only the chosen stop', () => {
    // La línea no cuenta nada: lo único que cambia al marcar es su círculo.
    expect(experienceStops('some_practice').map((stop) => stop.chosen)).toEqual([
      false,
      true,
      false,
    ])
  })

  test('draws the whole track cold while nothing is chosen, rather than hiding it', () => {
    // La escala tiene que verse antes de contestar: si apareciera al elegir, sólo la
    // vería quien ya decidió.
    const stops = experienceStops(undefined)

    expect(stops).toHaveLength(3)
    expect(stops.some((stop) => stop.chosen)).toBe(false)
  })

  test('marks only the last stop as last, so one thread never dangles', () => {
    expect(experienceStops('experienced').map((stop) => stop.last)).toEqual([false, false, true])
  })

  test('answers a cold track for a code it cannot draw rather than throwing', () => {
    expect(experienceStops('advanced' as never).every((stop) => !stop.chosen)).toBe(true)
  })
})

describe('readLevel', () => {
  test('reopens on the level that was saved', () => {
    expect(readLevel('some_practice')).toBe('some_practice')
  })

  test('reads nothing saved as nothing chosen', () => {
    expect(readLevel(null)).toBeUndefined()
    expect(readLevel(undefined)).toBeUndefined()
    expect(readLevel('')).toBeUndefined()
  })

  test('drops a level it cannot draw instead of failing', () => {
    // The catalogue can gain a member before this app version knows about it, and an
    // unknown level must not blank the screen.
    expect(readLevel('elite')).toBeUndefined()
  })

  test('round trips every level the screen can hold', () => {
    for (const level of TRAINING_EXPERIENCE) {
      expect(readLevel(level)).toBe(level)
    }
  })
})

describe('canSubmitExperience', () => {
  const level: TrainingExperience = 'starting'

  test('refuses until something is chosen, because nothing arrives selected', () => {
    expect(
      canSubmitExperience({ level: undefined, submitting: false, sessionExpired: false }),
    ).toBe(false)
  })

  test('allows a chosen level', () => {
    expect(canSubmitExperience({ level, submitting: false, sessionExpired: false })).toBe(true)
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitExperience({ level, submitting: true, sessionExpired: false })).toBe(false)
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitExperience({ level, submitting: false, sessionExpired: true })).toBe(false)
  })
})
