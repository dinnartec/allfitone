export type {
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
// Switching providers means changing this line and writing the new adapter.
export { createWorkOSAuthProvider as createAuthProvider } from './adapters/workos.js'
