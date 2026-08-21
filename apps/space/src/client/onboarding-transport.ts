/**
 * The native half of the onboarding flow.
 *
 * Everything that cannot run outside the app lives here and nowhere else: the
 * stored session, the bearer header and `expo-crypto`. `onboarding.ts` holds the
 * decisions and stays loadable by the test runner, which is the whole reason the
 * two are separate files.
 *
 * Every call goes through `withRefresh`, so an expired access token renews itself
 * instead of reaching the person as "your session expired" while a valid refresh
 * token sits unused. That was the real behaviour before this wiring existed.
 */

import { newCommand, type CommandHeaders } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { ApiError, authorizedGet, authorizedPost, refreshSession } from './index'
import {
  createOnboardingFlow,
  type CurrentOnboardingAttempt,
  type OnboardingFlow,
} from './onboarding'
import { readSession, storeSession } from './session'
import { withRefresh } from './with-refresh'

export function createSpaceOnboardingFlow(): OnboardingFlow {
  return createOnboardingFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      startAttempt: (command) =>
        authenticated((token) =>
          authorizedPost('/space/v1/onboarding-attempts', command, undefined, token),
        ),
      recordEligibility: (command, attemptId, declaredAdult) =>
        authenticated((token) =>
          authorizedPost(
            `/space/v1/onboarding-attempts/${attemptId}/eligibility-evidence`,
            command,
            { declared_adult: declaredAdult },
            token,
          ),
        ),
      recordIdentity: (command, attemptId, identity) =>
        authenticated((token) =>
          authorizedPost(
            `/space/v1/onboarding-attempts/${attemptId}/identity`,
            command,
            identity,
            token,
          ),
        ),
      readCurrent: () =>
        authenticated((token) =>
          authorizedGet<CurrentOnboardingAttempt>('/space/v1/onboarding-attempts/current', token),
        ),
    },
  })
}

function authenticated<T>(send: (token: string | undefined) => Promise<T>): Promise<T> {
  return withRefresh(
    {
      session: async () => {
        const stored = await readSession()
        if (!stored) return null
        return { accessToken: stored.accessToken, refreshToken: stored.refreshToken }
      },
      persist: (tokens) => storeSession({ ...tokens, analytics: { distinct_id: null } }),
      refresh: async (refreshToken) => {
        const rotated = await refreshSession(refreshToken)
        return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken }
      },
      unauthorized: (error) => error instanceof ApiError && error.failure === 'unauthenticated',
    },
    send,
  )
}

export type { CommandHeaders }
