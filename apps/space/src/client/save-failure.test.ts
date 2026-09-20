/**
 * `T-SP-FAIL-01..05` — what a failed save tells somebody.
 *
 * The one that matters is the stale draft. It used to read «revisa tu conexión», which
 * sent people to look at their wifi for a problem that was not there — and left the
 * one thing they could actually do, reopen the screen, unsaid.
 */

import { describe, expect, test } from 'bun:test'

import { ApiError } from './api-error'
import {
  DISCARD_FAILED,
  SAVE_GONE,
  SAVE_OFFLINE,
  SAVE_REFUSED,
  SAVE_STALE,
  SESSION_EXPIRED,
  discardFailure,
  saveFailure,
} from './save-failure'

describe('why a save did not land', () => {
  test('T-SP-FAIL-01 a stale draft says what happened and what to do', () => {
    expect(saveFailure(new ApiError('conflict'))).toBe(SAVE_STALE)
  })

  test('T-SP-FAIL-02 a request the server refused is called our fault, not the wifi', () => {
    expect(saveFailure(new ApiError('invalid-request'))).toBe(SAVE_REFUSED)
  })

  test('T-SP-FAIL-03 something discarded elsewhere is gone, not unreachable', () => {
    expect(saveFailure(new ApiError('not-found'))).toBe(SAVE_GONE)
  })

  test('T-SP-FAIL-04 an expired session is the one that needs signing in again', () => {
    expect(saveFailure(new ApiError('unauthenticated'))).toBe(SESSION_EXPIRED)
  })

  test('T-SP-FAIL-05 and anything that is not an answer at all is the connection', () => {
    expect(saveFailure(new TypeError('Network request failed'))).toBe(SAVE_OFFLINE)
    expect(saveFailure(new ApiError('unavailable'))).toBe(SAVE_OFFLINE)
  })
})

describe('why a photograph did not become a cover', () => {})

describe('discardFailure', () => {
  test('names the programme when the routine is only in one, and says what to do', () => {
    // «Quítala de ahí primero» era un callejón: un programa publicado no se puede vaciar
    // ni descartar, así que quien siguiera el consejo daba vueltas.
    expect(discardFailure(new ApiError('conflict'), [{ title: 'Ini' }])).toBe(
      '«Ini» no puede quedarse sin rutinas. Añádele otra antes de descartar esta.',
    )
  })

  test('and stays general when it cannot know which one would be left empty', () => {
    const several = discardFailure(new ApiError('conflict'), [{ title: 'A' }, { title: 'B' }])
    expect(several).toContain('no puede quedarse sin rutinas')
    expect(several).not.toContain('«A»')
  })

  test('anything else is the retry it actually is', () => {
    expect(discardFailure(new Error('red'), [])).toBe(DISCARD_FAILED)
  })
})
