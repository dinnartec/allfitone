/**
 * What has to be true about the discipline step.
 *
 * Two claims a screenshot cannot judge. Only the disciplines that are ready can be
 * chosen — the other five are drawn on purpose and choosing one would be a promise
 * nothing keeps. And the goal list depends on the answer, which is the whole reason
 * this question comes before the goal.
 */

import { describe, expect, test } from 'bun:test'

import {
  DISCIPLINES,
  canSubmitDiscipline,
  disciplineAt,
  goalsFor,
  indexOfDiscipline,
  sealFor,
} from './discipline-form'
import { DISCIPLINE_ART } from './discipline-art'
import { TRAINING_GOALS } from './goal-form'

const strength = disciplineAt(0)
const notReady = disciplineAt(1)

describe('the carousel', () => {
  test('T-SP-DISC-01 shows the six the product is going to cover', () => {
    expect(DISCIPLINES).toHaveLength(6)
  })

  test('T-SP-DISC-02 opens on the one that can be chosen', () => {
    // Somebody who swipes past everything still lands on a screen they can leave.
    expect(strength.code).toBe('strength')
    expect(strength.available).toBe(true)
  })

  test('T-SP-DISC-03 and exactly one is available today', () => {
    expect(DISCIPLINES.filter((card) => card.available)).toEqual([strength])
  })

  test('T-SP-DISC-04 every card carries what somebody recognises their practice by', () => {
    for (const card of DISCIPLINES) {
      expect(card.practices.length).toBeGreaterThan(0)
    }
  })

  test('T-SP-DISC-14 and every card has a drawing', () => {
    // Six cards whose argument is that the disciplines differ; one without an
    // illustration reads as the card that failed to load.
    for (const card of DISCIPLINES) {
      expect(DISCIPLINE_ART[card.code]?.strokes.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('T-SP-DISC-05 the seal never offers to tell anybody when it is ready', () => {
    // No interest is recorded, so a notice would be a promise nothing keeps.
    expect(sealFor(strength)).toBe('LISTA HOY')
    expect(sealFor(notReady)).toBe('PRÓXIMAMENTE')
  })

  test('T-SP-DISC-06 an index past either end lands on a real card', () => {
    expect(disciplineAt(-3)).toBe(strength)
    expect(disciplineAt(99)).toBe(disciplineAt(DISCIPLINES.length - 1))
  })

  test('T-SP-DISC-07 an unknown or absent answer opens on the first card', () => {
    expect(indexOfDiscipline(undefined)).toBe(0)
    expect(indexOfDiscipline('quidditch')).toBe(0)
    expect(indexOfDiscipline('combat_sports')).toBe(3)
  })
})

describe('what may be submitted', () => {
  test('T-SP-DISC-08 a discipline that is not ready cannot be chosen', () => {
    expect(canSubmitDiscipline({ card: notReady, submitting: false, sessionExpired: false })).toBe(
      false,
    )
  })

  test('T-SP-DISC-09 the one that is ready can', () => {
    expect(canSubmitDiscipline({ card: strength, submitting: false, sessionExpired: false })).toBe(
      true,
    )
  })

  test('T-SP-DISC-10 and neither while submitting or after the session expired', () => {
    expect(canSubmitDiscipline({ card: strength, submitting: true, sessionExpired: false })).toBe(
      false,
    )
    expect(canSubmitDiscipline({ card: strength, submitting: false, sessionExpired: true })).toBe(
      false,
    )
  })
})

describe('the goal depends on the discipline', () => {
  test('T-SP-DISC-11 strength drops running a race and keeps the rest', () => {
    // Strength training does not chase a race, and offering it would promise a plan
    // this discipline is never going to write.
    expect(goalsFor('strength', TRAINING_GOALS)).toEqual([
      'lose_weight',
      'build_muscle',
      'get_fit',
      'maintain',
    ])
  })

  test('T-SP-DISC-12 and never drops every goal, whatever the discipline', () => {
    for (const card of DISCIPLINES) {
      expect(goalsFor(card.code as 'strength', TRAINING_GOALS).length).toBeGreaterThan(0)
    }
  })

  test('T-SP-DISC-13 an unanswered discipline offers the whole list', () => {
    // The goal screen is reachable by the back arrow before the answer exists.
    expect(goalsFor(null, TRAINING_GOALS)).toEqual(TRAINING_GOALS)
  })
})
