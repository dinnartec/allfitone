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
  user: {
    id: string
    email: string
    emailVerified: boolean
    firstName: string | null
    lastName: string | null
  }
  /**
   * How the person authenticated. Notably this union contains no TOTP or MFA
   * value, and it is absent from the access token — see the AAL note in
   * workos.ts.
   */
  authenticationMethod?: string
}

export interface WorkOSUser {
  id: string
  /** Whether a code is still outstanding for this address. */
  emailVerified: boolean
}

/** What `getUser` returns and `identityFor` reads. Verified against the SDK types. */
export interface WorkOSUserProfile extends WorkOSUser {
  email: string
  firstName: string | null
  lastName: string | null
}

export interface WorkOSSession {
  id: string
}

export interface WorkOSMultiFactorAuth {
  enrollFactor(options: { type: 'totp'; issuer: string; user: string }): Promise<{
    id: string
    totp?: { qrCode: string; secret: string; uri: string; issuer: string; user: string }
  }>
  challengeFactor(options: { authenticationFactorId: string }): Promise<{
    id: string
    expiresAt?: string
  }>
  verifyChallenge(options: {
    authenticationChallengeId: string
    code: string
  }): Promise<{ valid: boolean }>
  deleteFactor(id: string): Promise<void>
}

/** Common event envelope returned after the SDK verifies and deserializes it. */
export interface WorkOSEvent {
  id: string
  createdAt: string
  event: string
  data: unknown
}

export interface WorkOSWebhooks {
  constructEvent(options: {
    payload: string
    sigHeader: string
    secret: string
    tolerance: number
  }): Promise<WorkOSEvent>
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

  createPasswordReset(options: { email: string }): Promise<unknown>

  createUser(options: { email: string; password: string }): Promise<{ id: string }>

  /** Lookup by subject. The contact email is the provider's fact, never the client's. */
  getUser(userId: string): Promise<WorkOSUserProfile>

  /**
   * Filtering by email is the only lookup the SDK offers — there is no
   * getUserByEmail. Returns an AutoPaginatable; we read the current page.
   */
  listUsers(options: { email: string }): Promise<{ data: WorkOSUser[] }>

  /** Sends the code. Creating a user opens a verification but does not email it. */
  sendVerificationEmail(options: { userId: string }): Promise<unknown>

  /** Marks the address verified. Does not authenticate; that is a second call. */
  verifyEmail(options: { code: string; userId: string }): Promise<unknown>

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

  getLogoutUrl(options: { sessionId: string; returnTo?: string }): string
}

export interface WorkOSClient {
  userManagement: WorkOSUserManagement
  multiFactorAuth: WorkOSMultiFactorAuth
  webhooks: WorkOSWebhooks
}
