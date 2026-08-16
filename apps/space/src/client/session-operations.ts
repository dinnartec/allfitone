export const ACCESS_TOKEN_KEY = 'allfit.accessToken'
export const REFRESH_TOKEN_KEY = 'allfit.refreshToken'

export interface StoredSession {
  accessToken: string
  refreshToken: string
  analytics: { distinct_id: string | null }
}

export interface SessionStorage {
  setItemAsync(key: string, value: string): Promise<void>
  getItemAsync(key: string): Promise<string | null>
  deleteItemAsync(key: string): Promise<void>
}

export interface SessionOperationsOptions {
  storage: SessionStorage
  analyticsIdentityKey: string
  setTelemetryIdentity(value: string | null): void | Promise<void>
}

export function createSessionOperations(options: SessionOperationsOptions) {
  return {
    async storeSession(session: StoredSession): Promise<void> {
      await Promise.all([
        options.storage.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken),
        options.storage.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken),
      ])
      notifyIdentity(options, session.analytics.distinct_id)
      void persistAnalyticsIdentity(options, session.analytics.distinct_id)
    },

    async readSession(): Promise<StoredSession | null> {
      const [accessToken, refreshToken] = await Promise.all([
        options.storage.getItemAsync(ACCESS_TOKEN_KEY),
        options.storage.getItemAsync(REFRESH_TOKEN_KEY),
      ])
      if (!accessToken || !refreshToken) return null

      void restoreAnalyticsIdentity(options)
      return { accessToken, refreshToken, analytics: { distinct_id: null } }
    },

    async clearSession(): Promise<void> {
      notifyIdentity(options, null)
      await Promise.all([
        options.storage.deleteItemAsync(ACCESS_TOKEN_KEY),
        options.storage.deleteItemAsync(REFRESH_TOKEN_KEY),
      ])
      void options.storage.deleteItemAsync(options.analyticsIdentityKey).catch(() => undefined)
    },
  }
}

function notifyIdentity(options: SessionOperationsOptions, distinctId: string | null): void {
  try {
    void Promise.resolve(options.setTelemetryIdentity(distinctId)).catch(() => undefined)
  } catch {
    // Analytics runtime failures cannot change a product session outcome.
  }
}

async function persistAnalyticsIdentity(
  options: SessionOperationsOptions,
  distinctId: string | null,
): Promise<void> {
  try {
    if (distinctId) await options.storage.setItemAsync(options.analyticsIdentityKey, distinctId)
    else await options.storage.deleteItemAsync(options.analyticsIdentityKey)
  } catch {
    // Analytics persistence is best effort.
  }
}

async function restoreAnalyticsIdentity(options: SessionOperationsOptions): Promise<void> {
  try {
    const distinctId = await options.storage.getItemAsync(options.analyticsIdentityKey)
    notifyIdentity(options, distinctId)
  } catch {
    notifyIdentity(options, null)
  }
}
