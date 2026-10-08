export type {
  AuthorizationRequest,
  AuthenticatedIdentity,
  AuthProvider,
  AuthProviderEvent,
  AuthResult,
  ExternalSubject,
  LogoutRequest,
  PasswordCredentials,
  SessionTokens,
  Surface,
  TotpChallenge,
  TotpEnrollment,
  TotpVerification,
  VerifiedToken,
} from './port.js'

export { AuthError, type AuthErrorCode } from './errors.js'

// The only place in the monorepo where the provider is chosen.
// Switching providers means changing these lines and writing the new adapter.
export { createWorkOSAuthProvider } from './adapters/workos.js'
export {
  createAccountRecoveryDelivery,
  createAccountRecoveryDeliveryFromEnv,
  createAuthProviderFromEnv,
  createBackofficeAuthMaintenanceFromEnv,
  type AccountRecoveryDelivery,
  type BackofficeAuthMaintenance,
  type ProviderEnv,
} from './factory.js'
