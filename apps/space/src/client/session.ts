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
import { createSessionOperations } from './session-operations'

export type { StoredSession } from './session-operations'

const operations = createSessionOperations({
  storage: SecureStore,
  analyticsIdentityKey: ANALYTICS_IDENTITY_KEY,
  setTelemetryIdentity: setSpaceTelemetryIdentity,
})

export const storeSession = operations.storeSession
export const readSession = operations.readSession
export const clearSession = operations.clearSession
