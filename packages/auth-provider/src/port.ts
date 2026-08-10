/**
 * Identity provider port.
 *
 * Speaks Allfit's language, not the vendor's. That is the only reason it is
 * useful: if these types mirrored the provider's response with different names,
 * this would be an alias rather than an abstraction.
 *
 * Test that the port is right: an adapter for a different provider should be
 * writable without editing this file.
 */

/** The provider's `sub`. Resolves to a person via `identity.access_accounts`. */
export type ExternalSubject = string

/** Which surface requested the token. A Space token must not operate on /backoffice/v1. */
export type Surface = 'space' | 'studio' | 'backoffice'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  /** Seconds until the access token expires. */
  expiresIn: number
}

export interface AuthResult {
  subject: ExternalSubject
  tokens: SessionTokens
}

/**
 * What the API accepts from a verified token. Deliberately minimal.
 *
 * The provider also issues `org_id`, `role` and `permissions`. They are NOT
 * exposed here and must never be used to authorize: organizations, roles,
 * relationships and consents live in PostgreSQL and are resolved inside the
 * transaction. Trusting those claims would create a second source of truth for
 * authorization that silently drifts from the first.
 */
export interface VerifiedToken {
  subject: ExternalSubject
  /** `sid` — identifies the session, for revocation and audit. */
  sessionId: string
  /** Surface derived from the token's `client_id`. */
  surface: Surface
}

export interface PasswordCredentials {
  email: string
  password: string
}

export interface AuthorizationRequest {
  surface: Surface
  /** Where the provider sends the person back. Must match what is registered. */
  redirectUri: string
  /**
   * CSRF protection. Generated per attempt, echoed back on the callback, and
   * verified there. Without it, an attacker can hand a victim a callback URL
   * carrying their own code and land the victim in the attacker's session.
   */
  state: string
  /**
   * Force a fresh login when the last active authentication is older than this.
   * The path to re-authentication for sensitive operations.
   */
  maxAgeSeconds?: number
}

export interface LogoutRequest {
  /** `sid` from the verified access token. */
  sessionId: string
  /** Trusted application URL registered with the provider. */
  returnTo: string
}

/**
 * What a registration attempt tells the caller. Deliberately nothing.
 *
 * There is no "created" flag and no identifier, because the endpoint above this
 * must answer identically whether or not the address already had an account.
 * Returning anything the caller could branch on would push the decision one
 * layer up and eventually leak.
 */
export interface RegistrationOutcome {
  /**
   * True when a credential was created and a code sent. **For server-side
   * metrics and logs only** — a caller that varies its response on this
   * reintroduces exactly the disclosure the port exists to prevent.
   */
  readonly created: boolean
  /**
   * True when the address already existed, was unverified, and a fresh code went
   * out. Server-side signal only, on the same terms as `created`.
   */
  readonly resent?: boolean
}

export interface AuthProvider {
  /**
   * Where to send the person to authenticate. Used by the hosted flow.
   *
   * Built here rather than by the client, so no frontend needs to know the
   * provider exists.
   */
  getAuthorizationUrl(request: AuthorizationRequest): string

  /**
   * Creates a credential and sends a verification code.
   *
   * Never throws for an address that already has an account: that case is
   * indistinguishable from success by design, and a distinct error here would
   * only move the disclosure into a `catch`. Malformed addresses and provider
   * outages still throw.
   *
   * Creates no person and no domain record. The account is a credential until
   * onboarding completes.
   */
  register(credentials: PasswordCredentials): Promise<RegistrationOutcome>

  /**
   * Confirms possession of the address, then authenticates.
   *
   * Two provider calls rather than one, because the only call that redeems a
   * code and returns a session at once needs a token that is invalidated the
   * moment the code is emailed — the two are mutually exclusive. Marking the
   * address verified and then signing in normally is the flow that works.
   *
   * Takes the password because the second half is an ordinary sign-in. Returns
   * tokens because the person proved control of the mailbox, so asking again
   * for the password they typed a minute earlier buys nothing.
   *
   * Throws `invalid_credentials` for a wrong code, a wrong password and an
   * unknown address alike.
   */
  verifyEmail(credentials: PasswordCredentials, code: string, surface: Surface): Promise<AuthResult>

  /** Hosted logout URL for exactly one provider session. */
  getLogoutUrl(request: LogoutRequest): string

  /** Direct login. Used by Space, which has its own native screens. */
  authenticateWithPassword(credentials: PasswordCredentials, surface: Surface): Promise<AuthResult>

  /** Code exchange for the hosted flow. Used by Studio and Backoffice. */
  authenticateWithCode(code: string, surface: Surface): Promise<AuthResult>

  /** Refresh tokens rotate: the previous one is invalid once used. */
  refresh(refreshToken: string, surface: Surface): Promise<SessionTokens>

  /**
   * Verifies signature, expiry and issuer against the surface's JWKS.
   * Fails closed: any doubt is a rejection.
   */
  verifyAccessToken(token: string, surface: Surface): Promise<VerifiedToken>

  /**
   * Changes the sign-in email.
   *
   * Contact email and sign-in email are the same datum. The worker makes this
   * call from the outbox, never an HTTP request, because PostgreSQL and the
   * provider do not share a transaction.
   */
  updateEmail(subject: ExternalSubject, email: string): Promise<void>

  /** Ends all sessions. Invoked on password or email change. */
  revokeSessions(subject: ExternalSubject): Promise<void>
}
