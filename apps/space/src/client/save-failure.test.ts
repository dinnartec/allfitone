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
  SAVE_GONE,
  SAVE_OFFLINE,
  SAVE_REFUSED,
  SAVE_STALE,
  SESSION_EXPIRED,
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
