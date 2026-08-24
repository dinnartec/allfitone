import { describe, expect, test } from 'bun:test'

import {
  BAR_COUNT,
  barsFor,
  canSubmitExperience,
  chooseLevel,
  EXPERIENCE_LEVELS,
  levelDefinition,
  NOT_A_LABEL_BODY,
  NOT_A_LABEL_TITLE,
  readLevel,
  TRAINING_EXPERIENCE,
  type TrainingExperience,
} from './experience-form'

describe('EXPERIENCE_LEVELS', () => {
  test('offers the three simple terms the story names', () => {
    expect(TRAINING_EXPERIENCE).toEqual(['starting', 'some_practice', 'experienced'])
    expect(EXPERIENCE_LEVELS).toHaveLength(BAR_COUNT)
  })

  test('never uses the gym vocabulary', () => {
    // "Advanced" makes people underrate themselves and pick below their level, and
    // then the plan bores them. The words carry no rank; the bars do.
    const words = EXPERIENCE_LEVELS.map((entry) => entry.name.toLowerCase()).join(' ')

    for (const banned of ['principiante', 'intermedio', 'avanzado']) {
      expect(words).not.toContain(banned)
    }
  })

  test('is the only place order is stated, and it rises one bar at a time', () => {
    expect(EXPERIENCE_LEVELS.map((entry) => entry.bars)).toEqual([1, 2, 3])
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
})

describe('levelDefinition', () => {
  test('answers the definition of a level', () => {
    expect(levelDefinition('some_practice')?.bars).toBe(2)
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

describe('barsFor', () => {
  test('fills as many bars as the level declares', () => {
    expect(barsFor('starting')).toEqual([true, false, false])
    expect(barsFor('some_practice')).toEqual([true, true, false])
    expect(barsFor('experienced')).toEqual([true, true, true])
  })

  test('fills none when nothing is chosen, and still returns every bar', () => {
    // The scale has to be visible before answering, or the bars would only appear
    // once they no longer inform the choice.
    expect(barsFor(undefined)).toEqual([false, false, false])
  })

  test('fills none for a level it cannot draw', () => {
    expect(barsFor('advanced' as never)).toEqual([false, false, false])
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
