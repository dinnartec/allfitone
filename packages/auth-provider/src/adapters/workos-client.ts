/**
 * The exact slice of the WorkOS SDK this adapter depends on.
 *
 * Declared structurally rather than importing the SDK's class type, for two
 * reasons: it documents our dependency surface in one readable place, and it is
 * the seam that lets the adapter be tested without network.
 *
 * Every shape here was verified against @workos-inc/node 10.9.0 type
 * declarations, not against documentation. If a signature drifts, typecheck
 * fails at the construction site rather than silently at runtime.
 */

/** Subset of the SDK's AuthenticationResponse that we actually read. */
export interface WorkOSAuthenticationResponse {
  accessToken: string
  refreshToken: string
  user: { id: string }
  /**
   * How the person authenticated. Notably this union contains no TOTP or MFA
   * value, and it is absent from the access token — see the AAL note in
   * workos.ts.
   */
  authenticationMethod?: string
}

export interface WorkOSSession {
  id: string
}

export interface WorkOSUserManagement {
  authenticateWithCode(options: {
    code: string
    clientId: string
  }): Promise<WorkOSAuthenticationResponse>

  authenticateWithPassword(options: {
    email: string
    password: string
    clientId: string
  }): Promise<WorkOSAuthenticationResponse>

  authenticateWithRefreshToken(options: {
    refreshToken: string
    clientId: string
  }): Promise<WorkOSAuthenticationResponse>

  updateUser(options: { userId: string; email: string }): Promise<unknown>

  /** The SDK returns an AutoPaginatable; we only need the current page. */
  listSessions(userId: string): Promise<{ data: WorkOSSession[] }>

  /** Revokes exactly one session. There is no revoke-all in the SDK. */
  revokeSession(options: { sessionId: string }): Promise<void>

  getJwksUrl(clientId: string): string

  /**
   * The SDK rejects a call without one of provider / connectionId /
   * organizationId, so `provider` is required here rather than optional. For
   * the hosted flow the value is 'authkit'.
   */
  getAuthorizationUrl(options: {
    clientId: string
    redirectUri: string
    provider: 'authkit'
    state?: string
    maxAge?: number
  }): string
}

export interface WorkOSClient {
  userManagement: WorkOSUserManagement
}
