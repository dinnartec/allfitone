/**
 * `T-SP-HANDOFF-01..04` — the routine the editor hands back after publishing.
 *
 * The case with teeth is the second one. Without emptying on read, coming back to the
 * programme a second time would place the same routine on whatever day was waiting —
 * and the person would find a day they never filled, filled.
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  forgetPublishedRoutine,
  offerPublishedRoutine,
  takePublishedRoutine,
} from './routine-handoff'

const EMPUJE = { templateId: 'template-1', versionId: 'version-1' }

describe('what the editor hands back', () => {
  beforeEach(() => {
    forgetPublishedRoutine()
  })

  test('T-SP-HANDOFF-01 what was published is what is collected', () => {
    offerPublishedRoutine(EMPUJE)

    expect(takePublishedRoutine()).toEqual(EMPUJE)
  })

  test('T-SP-HANDOFF-02 collecting empties it, so a second look places nothing again', () => {
    offerPublishedRoutine(EMPUJE)
    takePublishedRoutine()

    expect(takePublishedRoutine()).toBeUndefined()
  })

  test('T-SP-HANDOFF-03 nothing published answers nothing, not an empty routine', () => {
    expect(takePublishedRoutine()).toBeUndefined()
  })

  test('T-SP-HANDOFF-04 the last one published is the one handed back', () => {
    // Two in one trip is a real sequence, and the answer is the one that just happened
    // rather than a list somebody has to choose from.
    offerPublishedRoutine(EMPUJE)
    offerPublishedRoutine({ templateId: 'template-2', versionId: 'version-2' })

    expect(takePublishedRoutine()?.templateId).toBe('template-2')
  })
})
