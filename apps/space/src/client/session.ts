/**
 * Where session tokens live on the device.
 *
 * `expo-secure-store` puts them in the Keychain on iOS and the Keystore on
 * Android, both backed by hardware. `AsyncStorage` would be plain text readable
 * by anything with filesystem access on a rooted device.
 *
 * HU-SP-003 requires that signing out leaves nothing consultable on the phone,
 * which is why clearing is a first-class operation here rather than something a
 * screen improvises.
 */

import * as SecureStore from 'expo-secure-store'

import { ANALYTICS_IDENTITY_KEY, setSpaceTelemetryIdentity } from './telemetry'
import { ApiError, refreshSession } from './index'
import { createSessionKeeper } from './session-keeper'
import { createSessionOperations } from './session-operations'

export type { StoredSession } from './session-operations'

const operations = createSessionOperations({
  storage: SecureStore,
  analyticsIdentityKey: ANALYTICS_IDENTITY_KEY,
  setTelemetryIdentity: setSpaceTelemetryIdentity,
})

/**
 * The one keeper of the session for the whole app: the keychain read once, renewals shared.
 * Writing or clearing the session tells it to read the keychain again.
 */
const keeper = createSessionKeeper({
  read: async () => {
    const stored = await operations.readSession()
    return stored ? { accessToken: stored.accessToken, refreshToken: stored.refreshToken } : null
  },
  persist: (tokens) => operations.storeSession({ ...tokens, analytics: { distinct_id: null } }),
  refresh: async (refreshToken) => {
    const rotated = await refreshSession(refreshToken)
    return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken }
  },
  now: () => Date.now(),
})

export const storeSession: typeof operations.storeSession = async (session) => {
  await operations.storeSession(session)
  keeper.forget()
}
export const readSession = operations.readSession
export const clearSession: typeof operations.clearSession = async () => {
  await operations.clearSession()
  keeper.forget()
}

/** An authenticated request with the kept session; a refusal renews once and retries once. */
export function authenticated<T>(send: (token: string | undefined) => Promise<T>): Promise<T> {
  return keeper.run(
    send,
    (error) => error instanceof ApiError && error.failure === 'unauthenticated',
  )
}
