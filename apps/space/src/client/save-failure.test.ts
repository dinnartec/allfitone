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
  coverFailure,
  PHOTO_NO_PICKER,
  PHOTO_UNREACHABLE,
  PHOTO_UNUSABLE,
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

describe('why a photograph did not become a cover', () => {
  test('T-SP-SAVE-08 an image the server would not take says so, and does not blame the wifi', () => {
    // The whole point of the separate reading: `validation-failed` on this route means
    // the file, and «revisa tu conexión» would send somebody looking for a problem that
    // is not there.
    expect(coverFailure(new ApiError('validation-failed'))).toBe(PHOTO_UNUSABLE)
  })

  test('T-SP-SAVE-09 anything that never reached the network blames the phone, not the wifi', () => {
    // Every request failure arrives as an `ApiError`, so what is left is the picker —
    // refusing to open, or missing from the build. «Revisa tu conexión» is the one
    // thing it is certainly not, and that is what it used to say.
    expect(coverFailure(new TypeError('cannot read property of undefined'))).toBe(PHOTO_UNREACHABLE)
  })

  test('T-SP-SAVE-11 a build without the picker says so, because installing it again is the fix', () => {
    const missing = new Error('picker-unavailable')
    missing.name = 'PickerUnavailable'
    expect(coverFailure(missing)).toBe(PHOTO_NO_PICKER)
  })

  test('T-SP-SAVE-10 and the rest reads exactly as a save does', () => {
    expect(coverFailure(new ApiError('unauthenticated'))).toBe(
      saveFailure(new ApiError('unauthenticated')),
    )
    expect(coverFailure(new ApiError('conflict'))).toBe(saveFailure(new ApiError('conflict')))
  })
})
