import type { SessionTokens } from '@allfitone/auth-provider'

export type RegistrationStatus = 'complete' | 'registration_incomplete'

export interface AccessAccount {
  accountId: string
  personId?: string
}

export interface StoredAccessSession {
  sessionId: string
  accountId: string
  personId?: string
  externalSubject: string
  providerSessionId: string
  tokenCiphertext: string
  accessTokenExpiresAt: Date
  tokenVersion: number
  personStatus?: 'active' | 'closed'
}

export interface ActorRegistration {
  personId?: string
  personStatus?: 'active' | 'closed'
}

export interface IdentitySessionDatabase {
  resolveOrCreateAccount(issuer: string, subject: string): Promise<AccessAccount>
  createSession(input: {
    accountId: string
    providerSessionId: string
    tokenHash: Uint8Array
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<string>
  loadSession(tokenHash: Uint8Array): Promise<StoredAccessSession | undefined>
  rotateSession(input: {
    sessionId: string
    expectedTokenVersion: number
    tokenCiphertext: string
    accessTokenExpiresAt: Date
  }): Promise<boolean>
  revokeSession(sessionId: string): Promise<boolean>
  resolveRegistration(accountId: string): Promise<ActorRegistration>
}

export interface SessionTokenVault {
  generateOpaqueToken(): string
  hashOpaqueToken(token: string): Uint8Array
  seal(tokens: SessionTokens, context: SessionCipherContext): string
  open(ciphertext: string, context: SessionCipherContext): SessionTokens
}

export interface SessionCipherContext {
  accountId: string
  providerSessionId: string
  surface: 'studio'
}
