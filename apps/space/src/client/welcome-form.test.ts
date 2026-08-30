import { describe, expect, it } from 'bun:test'

import { canActivate, completionFor, welcomeVariant } from './welcome-form'

describe('welcomeVariant', () => {
  it('shows the woman only when female was declared', () => {
    expect(welcomeVariant('female')).toBe('female')
  })

  it('shows the man for male and for declining', () => {
    expect(welcomeVariant('male')).toBe('male')
    expect(welcomeVariant(null)).toBe('male')
  })
})

describe('completionFor', () => {
  it('carries the name and accepts both documents', () => {
    expect(completionFor({ given_name: 'Ada', family_name: 'Lovelace' })).toEqual({
      given_name: 'Ada',
      family_name: 'Lovelace',
      terms_accepted: true,
      privacy_notice_accepted: true,
    })
  })
})

describe('canActivate', () => {
  const ready = {
    identity: { given_name: 'Ada', family_name: 'Lovelace' },
    activating: false,
    activated: false,
    sessionExpired: false,
  }

  it('allows activating once the name has been read', () => {
    expect(canActivate(ready)).toBe(true)
  })

  it('refuses before the attempt has been read', () => {
    expect(canActivate({ ...ready, identity: undefined })).toBe(false)
  })

  it('refuses while a command is in flight', () => {
    expect(canActivate({ ...ready, activating: true })).toBe(false)
  })

  it('refuses once activated, so a second press is not a second command', () => {
    expect(canActivate({ ...ready, activated: true })).toBe(false)
  })

  it('refuses with the session gone, because the button signs in instead', () => {
    expect(canActivate({ ...ready, sessionExpired: true })).toBe(false)
  })
})
