/**
 * Opening an onboarding attempt and recording the adult declaration.
 *
 * The screen keeps none of this. What lives here is the part worth testing: the
 * idempotency key belongs to a submission, so it is created on the first press,
 * reused while that submission is failing, and discarded once it lands. A key
 * bound to mounting would change for reasons unrelated to intent — React
 * remounts on navigation and on fast refresh — and a key per tap would defeat the
 * purpose, since a lost response followed by a second press would record two
 * declarations of the same fact.
 *
 * Changing the answer starts a new submission. The API hashes the body, so a
 * reused key with different content comes back as a conflict rather than merging
 * two evaluations, but sending a fresh one is the honest thing to do.
 *
 * The attempt itself is opened once and kept. `OP-IDN-001` is idempotent for an
 * account that already has an open attempt, so this is an optimisation rather
 * than a correctness requirement.
 *
 * Nothing native is imported. Randomness arrives as a dependency because
 * `expo-crypto` cannot load in the test runner, and a module that reached for it
 * directly could only be checked by launching the app.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

export type OnboardingAttempt = AllfitV1Schemas['SpaceOnboardingAttempt']
export type AdultEligibilityEvidence = AllfitV1Schemas['AdultEligibilityEvidence']
export type OnboardingIdentity = AllfitV1Schemas['SpaceOnboardingIdentity']
export type CurrentOnboardingAttempt = AllfitV1Schemas['SpaceCurrentOnboardingAttempt']

export interface OnboardingTransport {
  startAttempt(command: CommandHeaders): Promise<OnboardingAttempt>
  recordEligibility(
    command: CommandHeaders,
    attemptId: string,
    declaredAdult: boolean,
  ): Promise<AdultEligibilityEvidence>
  recordIdentity(
    command: CommandHeaders,
    attemptId: string,
    identity: OnboardingIdentity,
  ): Promise<OnboardingIdentity>
  readCurrent(): Promise<CurrentOnboardingAttempt>
}

export interface OnboardingFlowDependencies {
  transport: OnboardingTransport
  /**
   * Supplied, never imported. `expo-crypto` is a native module and importing it
   * here would make this file impossible to load outside the app.
   */
  newCommand: () => CommandHeaders
}

export interface OnboardingFlow {
  declareAdult(declaredAdult: boolean): Promise<AdultEligibilityEvidence>
  declareIdentity(identity: OnboardingIdentity): Promise<OnboardingIdentity>
  /** What was already answered, so coming back does not start over. */
  resume(): Promise<CurrentOnboardingAttempt>
}

export function createOnboardingFlow(dependencies: OnboardingFlowDependencies): OnboardingFlow {
  const issue = dependencies.newCommand
  let attempt: OnboardingAttempt | undefined
  let pendingAdult: { command: CommandHeaders; declaredAdult: boolean } | undefined
  let pendingIdentity: { command: CommandHeaders; identity: string } | undefined

  const openAttempt = async (): Promise<OnboardingAttempt> => {
    attempt ??= await dependencies.transport.startAttempt(issue())
    return attempt
  }

  return {
    async declareAdult(declaredAdult) {
      const open = await openAttempt()

      if (!pendingAdult || pendingAdult.declaredAdult !== declaredAdult) {
        pendingAdult = { command: issue(), declaredAdult }
      }

      const evidence = await dependencies.transport.recordEligibility(
        pendingAdult.command,
        open.id,
        declaredAdult,
      )
      pendingAdult = undefined
      return evidence
    },

    async declareIdentity(identity) {
      const open = await openAttempt()
      const answer = `${identity.given_name}\u0000${identity.family_name}\u0000${identity.username}`

      // The key belongs to the submission: a retry of the same answer replays,
      // and a corrected one is a different command that must not reuse it.
      if (!pendingIdentity || pendingIdentity.identity !== answer) {
        pendingIdentity = { command: issue(), identity: answer }
      }

      const stored = await dependencies.transport.recordIdentity(
        pendingIdentity.command,
        open.id,
        identity,
      )
      pendingIdentity = undefined
      return stored
    },

    async resume() {
      const current = await dependencies.transport.readCurrent()
      // Reuse what the server already has rather than opening a second attempt.
      if (current.attempt) attempt = current.attempt
      return current
    },
  }
}
