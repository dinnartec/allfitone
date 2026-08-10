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

const ACCESS_TOKEN = 'allfit.accessToken'
const REFRESH_TOKEN = 'allfit.refreshToken'

export interface StoredSession {
  accessToken: string
  refreshToken: string
}

export async function storeSession(session: StoredSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN, session.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN, session.refreshToken),
  ])
}

export async function readSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN),
    SecureStore.getItemAsync(REFRESH_TOKEN),
  ])
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN),
    SecureStore.deleteItemAsync(REFRESH_TOKEN),
  ])
}
