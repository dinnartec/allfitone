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

const ACCESS_TOKEN = 'allfit.accessToken'
const REFRESH_TOKEN = 'allfit.refreshToken'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  analytics: { distinct_id: string | null }
}

export async function storeSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN, session.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN, session.refreshToken),
    session.analytics.distinct_id
      ? SecureStore.setItemAsync(ANALYTICS_IDENTITY_KEY, session.analytics.distinct_id)
      : SecureStore.deleteItemAsync(ANALYTICS_IDENTITY_KEY),
  ])
  await setSpaceTelemetryIdentity(session.analytics.distinct_id)
}

export async function readSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken, distinctId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN),
    SecureStore.getItemAsync(REFRESH_TOKEN),
    SecureStore.getItemAsync(ANALYTICS_IDENTITY_KEY),
  ])
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken, analytics: { distinct_id: distinctId } }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN),
    SecureStore.deleteItemAsync(REFRESH_TOKEN),
    SecureStore.deleteItemAsync(ANALYTICS_IDENTITY_KEY),
  ])
  await setSpaceTelemetryIdentity(null)
}
