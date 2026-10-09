/**
 * Keeps the session alive without making anyone wait for it (HU-SP-002 criterion 4).
 *
 * Every authenticated request used to read the keychain, send, and only after a `401`
 * renew the access token against the provider and send again: three round trips, the
 * slowest one (~600 ms) in the middle, every time a screen came back after a few minutes.
 * And each of a screen's parallel requests renewed on its own, so the rotating refresh
 * token was spent several times at once — a race that can end a valid session.
 *
 * So the session lives in memory, read from the keychain once; a token about to lapse is
 * renewed *before* it is sent, from the `exp` its JWT carries; and one renewal is shared by
 * everyone who needs it at that moment. A `401` still renews and retries once, as a safety
 * net for a token the clock did not see coming. A refused renewal surfaces the original
 * refusal, and nothing retries twice.
 *
 * Nothing here touches storage or the network itself, so the rules are tested without the
 * app.
 */

export interface SessionTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}

export interface KeeperDependencies {
  read(): Promise<SessionTokenPair | null>
  persist(tokens: SessionTokenPair): Promise<void>
  refresh(refreshToken: string): Promise<SessionTokenPair>
  /** Milliseconds since the epoch. */
  now(): number
}

/** Renewed this long before it lapses, so a request never leaves with a dying token. */
const RENEW_BEFORE_MS = 60_000

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** A base64url segment as text; the runtime's `atob` is not typed in React Native. */
function decodeSegment(segment: string): string {
  let bits = 0
  let value = 0
  let text = ''
  for (const letter of segment.replace(/=+$/, '')) {
    const index = BASE64.indexOf(letter === '+' ? '-' : letter === '/' ? '_' : letter)
    if (index === -1) throw new Error('not base64')
    value = (value << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      text += String.fromCharCode((value >> bits) & 0xff)
    }
  }
  return decodeURIComponent(escape(text))
}

/** When a JWT access token lapses, in milliseconds; null when it is not a readable JWT. */
function lapsesAt(accessToken: string): number | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(decodeSegment(payload))
    if (typeof claims !== 'object' || claims === null || !('exp' in claims)) return null
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

export function createSessionKeeper(dependencies: KeeperDependencies) {
  // undefined until the keychain has been read; null when there is no session.
  let cached: SessionTokenPair | null | undefined
  let loading: Promise<SessionTokenPair | null> | null = null
  let renewing: Promise<SessionTokenPair> | null = null

  async function current(): Promise<SessionTokenPair | null> {
    if (cached !== undefined) return cached
    loading ??= dependencies.read().then((stored) => {
      cached = stored
      loading = null
      return stored
    })
    return loading
  }

  /** One renewal at a time: whoever asks while one is running waits for that one. */
  function renew(session: SessionTokenPair): Promise<SessionTokenPair> {
    renewing ??= dependencies
      .refresh(session.refreshToken)
      .then(async (rotated) => {
        cached = rotated
        await dependencies.persist(rotated)
        return rotated
      })
      .finally(() => {
        renewing = null
      })
    return renewing
  }

  async function usable(): Promise<SessionTokenPair | null> {
    const session = await current()
    if (!session) return null
    const lapses = lapsesAt(session.accessToken)
    if (lapses === null || lapses - dependencies.now() > RENEW_BEFORE_MS) return session
    // About to lapse: renew first. If the provider refuses, send what there is and let
    // the refusal path decide.
    return renew(session).catch(() => session)
  }

  return {
    /** Sends with the current token; a refusal renews once and retries once. */
    async run<T>(
      send: (token: string | undefined) => Promise<T>,
      unauthorized: (error: unknown) => boolean,
    ): Promise<T> {
      const session = await usable()
      try {
        return await send(session?.accessToken)
      } catch (rejection) {
        if (!session || !unauthorized(rejection)) throw rejection
        // Someone else may have renewed while this request was out; use theirs.
        const latest = await current()
        let rotated: SessionTokenPair
        try {
          rotated =
            latest && latest.accessToken !== session.accessToken ? latest : await renew(session)
        } catch {
          throw rejection
        }
        return send(rotated.accessToken)
      }
    },

    /** After a sign-in or sign-out wrote the keychain, read it again on the next request. */
    forget(): void {
      cached = undefined
      loading = null
    },
  }
}
