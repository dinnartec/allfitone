/**
 * Runs an authenticated request, renewing the session once if it is refused.
 *
 * HU-SP-002 criterion 4 asks that the session survive closing the app. Storing
 * the tokens only gets halfway: an access token is short-lived, so the first
 * request after a pause comes back `401` while a valid refresh token sits unused,
 * and the person is told to sign in again for nothing. That was the actual
 * behaviour on device before this existed.
 *
 * Exactly one retry. A second refusal after a fresh token means the session is
 * genuinely gone, and retrying past that would spin against the provider on every
 * request. A failed refresh surfaces the original rejection rather than its own,
 * because what the caller needs to know is that the request was refused, not how
 * the recovery went.
 *
 * Nothing here reads storage or talks to the network directly, so the rules can
 * be tested without launching the app.
 */

export interface SessionTokenPair {
  accessToken: string
  refreshToken: string
}

export interface RefreshDependencies {
  session(): Promise<SessionTokenPair | null>
  persist(tokens: SessionTokenPair): Promise<void>
  refresh(refreshToken: string): Promise<SessionTokenPair>
  unauthorized(error: unknown): boolean
}

export async function withRefresh<T>(
  dependencies: RefreshDependencies,
  send: (token: string | undefined) => Promise<T>,
): Promise<T> {
  const stored = await dependencies.session()

  try {
    return await send(stored?.accessToken)
  } catch (rejection) {
    if (!stored || !dependencies.unauthorized(rejection)) throw rejection

    let rotated: SessionTokenPair
    try {
      rotated = await dependencies.refresh(stored.refreshToken)
    } catch {
      throw rejection
    }

    await dependencies.persist(rotated)
    return send(rotated.accessToken)
  }
}
