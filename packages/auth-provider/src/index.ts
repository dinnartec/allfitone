export type {
  AuthorizationRequest,
  AuthProvider,
  AuthResult,
  ExternalSubject,
  PasswordCredentials,
  SessionTokens,
  Surface,
  VerifiedToken,
} from './port.js'

export { AuthError, type AuthErrorCode } from './errors.js'

// The only place in the monorepo where the provider is chosen.
// Switching providers means changing these lines and writing the new adapter.
export { createWorkOSAuthProvider } from './adapters/workos.js'
export { createAuthProviderFromEnv, type ProviderEnv } from './factory.js'
