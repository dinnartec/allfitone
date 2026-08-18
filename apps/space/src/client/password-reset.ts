/**
 * Asking for a password reset link.
 *
 * The API answers `202` for an address with an account, one without, and a
 * provider that is down — HU-SP-004 criterion 2. That leaves exactly one failure
 * the person can be told about: a request that never arrived. Anything else has
 * to read as sent, or the sheet would rebuild the disclosure the endpoint exists
 * to prevent.
 *
 * The address is checked for shape only, and only to avoid a pointless round
 * trip. Whether it can receive mail is the provider's business and, deliberately,
 * something we never learn.
 */

/** Shape only, and loose on purpose: the real test is whether mail arrives. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type PasswordResetOutcome = 'sent' | 'invalid' | 'unreachable'

export interface PasswordResetDependencies {
  request(email: string): Promise<void>
}

export interface PasswordResetFlow {
  submit(email: string): Promise<PasswordResetOutcome>
}

export function createPasswordResetFlow(
  dependencies: PasswordResetDependencies,
): PasswordResetFlow {
  return {
    async submit(email) {
      const address = email.trim()
      if (!EMAIL.test(address)) return 'invalid'

      try {
        await dependencies.request(address)
        return 'sent'
      } catch {
        return 'unreachable'
      }
    },
  }
}
