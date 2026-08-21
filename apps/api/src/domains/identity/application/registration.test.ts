/**
 * The rule under test is a promise, not a detail: a failed sign-in must not say
 * whether the address exists.
 *
 * HU-SP-002 criterion 2 requires one answer for a wrong password and for an
 * unknown address, and HU-SP-001 criterion 3 requires the same of registration.
 * Both collapse in `toRegistrationError`, so the assertions below compare the
 * resulting code rather than trusting that the provider's own distinction was
 * dropped somewhere along the way.
 */

import { AuthError, type AuthProvider } from '@allfitone/auth-provider'
import { describe, expect, test } from 'bun:test'

import { createSpaceRegistrationService, RegistrationError } from './registration.js'

const TOKENS = { accessToken: 'at_1', refreshToken: 'rt_1', expiresIn: 3600 }

function serviceWith(overrides: Partial<AuthProvider>) {
  return createSpaceRegistrationService({
    authProvider: overrides as AuthProvider,
    issuer: 'https://api.workos.test/user_management/client_space',
  })
}

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
  } catch (error) {
    if (error instanceof RegistrationError) return error.code
    throw error
  }
  throw new Error('expected the action to fail')
}

describe('signIn', () => {
  test('issues a session for the Space surface, never another one', async () => {
    const seen: string[] = []
    const service = serviceWith({
      authenticateWithPassword: async (_credentials, surface) => {
        seen.push(surface)
        return {
          subject: 'user_1',
          identity: { givenName: null, familyName: null, verifiedEmail: null },
          tokens: TOKENS,
        }
      },
    })

    const session = await service.signIn('alguien@dinnartec.co', 'Xk7pQr2m')

    expect(seen).toEqual(['space'])
    expect(session.accessToken).toBe('at_1')
    expect(session.refreshToken).toBe('rt_1')
    expect(session.expiresIn).toBe(3600)
  })

  test('answers a wrong password and an unknown address identically', async () => {
    const wrongPassword = serviceWith({
      authenticateWithPassword: async () => {
        throw new AuthError('invalid_credentials', 'password did not match')
      },
    })
    const unknownAddress = serviceWith({
      authenticateWithPassword: async () => {
        throw new AuthError('invalid_credentials', 'no user for that email')
      },
    })

    const first = await codeOf(() => wrongPassword.signIn('a@dinnartec.co', 'Xk7pQr2m'))
    const second = await codeOf(() => unknownAddress.signIn('b@dinnartec.co', 'Xk7pQr2m'))

    expect(first).toBe('unauthenticated')
    expect(second).toBe(first)
  })

  test('an unverified address is not distinguishable either', async () => {
    const service = serviceWith({
      authenticateWithPassword: async () => {
        throw new AuthError('invalid_token', 'email not verified')
      },
    })

    expect(await codeOf(() => service.signIn('a@dinnartec.co', 'Xk7pQr2m'))).toBe('unauthenticated')
  })

  test('separates a provider outage from a rejected credential', async () => {
    const service = serviceWith({
      authenticateWithPassword: async () => {
        throw new AuthError('provider_unavailable', 'gateway timeout')
      },
    })

    expect(await codeOf(() => service.signIn('a@dinnartec.co', 'Xk7pQr2m'))).toBe(
      'upstream-unavailable',
    )
  })
})

describe('refresh', () => {
  test('exchanges the token for a new pair on the Space surface', async () => {
    const seen: string[] = []
    const service = serviceWith({
      refresh: async (_token, surface) => {
        seen.push(surface)
        return { accessToken: 'at_2', refreshToken: 'rt_2', expiresIn: 3600 }
      },
    })

    const session = await service.refresh('rt_1')

    expect(seen).toEqual(['space'])
    expect(session.accessToken).toBe('at_2')
    expect(session.refreshToken).toBe('rt_2')
  })

  test('a rejected refresh token sends the person back to signing in', async () => {
    const service = serviceWith({
      refresh: async () => {
        throw new AuthError('invalid_token', 'refresh token already used')
      },
    })

    expect(await codeOf(() => service.refresh('rt_stale'))).toBe('unauthenticated')
  })

  test('an outage is retryable and must not clear the stored session', async () => {
    const service = serviceWith({
      refresh: async () => {
        throw new AuthError('provider_unavailable', 'gateway timeout')
      },
    })

    expect(await codeOf(() => service.refresh('rt_1'))).toBe('upstream-unavailable')
  })
})

describe('requestPasswordReset', () => {
  test('asks the provider on the Space surface', async () => {
    const seen: Array<{ email: string; surface: string }> = []
    const service = serviceWith({
      requestPasswordReset: async (email, surface) => {
        seen.push({ email, surface })
      },
    })

    await service.requestPasswordReset('Alguien@Dinnartec.co')

    expect(seen).toEqual([{ email: 'alguien@dinnartec.co', surface: 'space' }])
  })

  test('resolves for an address with no account, so the caller cannot tell', async () => {
    // HU-SP-004 criterion 2. The adapter already swallows the provider's 404;
    // this pins that the service does not reintroduce a difference above it.
    const service = serviceWith({ requestPasswordReset: async () => undefined })

    await expect(service.requestPasswordReset('nadie@dinnartec.co')).resolves.toBeUndefined()
  })

  test('surfaces an outage to the caller, which answers 202 anyway', async () => {
    // The service still reports it: hiding the failure here would leave the
    // handler unable to record the metric that tells us the provider is down.
    const service = serviceWith({
      requestPasswordReset: async () => {
        throw new AuthError('provider_unavailable', 'gateway timeout')
      },
    })

    expect(await codeOf(() => service.requestPasswordReset('a@dinnartec.co'))).toBe(
      'upstream-unavailable',
    )
  })
})
