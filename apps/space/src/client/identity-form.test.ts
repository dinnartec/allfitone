import { describe, expect, test } from 'bun:test'

import { canSubmitIdentity, isUsernameWellFormed } from './identity-form'

const VALID = {
  givenName: 'Ada',
  familyName: 'Lovelace',
  username: 'ada_lovelace',
  submitting: false,
  sessionExpired: false,
}

describe('isUsernameWellFormed', () => {
  test('accepts a lowercase handle that starts with a letter', () => {
    for (const username of ['ada', 'ada_lovelace', 'ada2', 'a_b', 'a'.repeat(30)]) {
      expect(isUsernameWellFormed(username)).toBe(true)
    }
  })

  test('refuses what the column constraint would refuse', () => {
    const refused = [
      '',
      'ad',
      'Ada',
      '1ada',
      '_ada',
      'ada lovelace',
      'ada-lovelace',
      'ada.lovelace',
      'a'.repeat(31),
    ]
    for (const username of refused) {
      expect(isUsernameWellFormed(username)).toBe(false)
    }
  })
})

describe('canSubmitIdentity', () => {
  test('allows a complete form', () => {
    expect(canSubmitIdentity(VALID)).toBe(true)
  })

  test('refuses while a submission is in flight', () => {
    expect(canSubmitIdentity({ ...VALID, submitting: true })).toBe(false)
  })

  test('refuses once the session is gone, because pressing could only fail', () => {
    expect(canSubmitIdentity({ ...VALID, sessionExpired: true })).toBe(false)
  })

  test('treats whitespace as an empty name rather than a name', () => {
    expect(canSubmitIdentity({ ...VALID, givenName: '   ' })).toBe(false)
    expect(canSubmitIdentity({ ...VALID, familyName: '\t' })).toBe(false)
  })

  test('refuses a malformed handle even with both names given', () => {
    expect(canSubmitIdentity({ ...VALID, username: 'Ada' })).toBe(false)
  })
})
