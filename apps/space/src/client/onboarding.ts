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
export type PendingFitnessId = AllfitV1Schemas['SpacePendingFitnessId']
export type CurrentOnboardingAttempt = AllfitV1Schemas['SpaceCurrentOnboardingAttempt']
export type BiologicalSex = AllfitV1Schemas['BiologicalSex']
export type PrimaryTrainingGoal = AllfitV1Schemas['PrimaryTrainingGoal']
export type ProfileClaim = AllfitV1Schemas['SpaceProfileClaim']
export type FocusArea = AllfitV1Schemas['FocusArea']
export type TrainingExperience = AllfitV1Schemas['TrainingExperience']
export type TrainingExperienceClaim = AllfitV1Schemas['SpaceTrainingExperienceClaim']

export interface OnboardingTransport {
  startAttempt(command: CommandHeaders): Promise<OnboardingAttempt>
  recordEligibility(
    command: CommandHeaders,
    attemptId: string,
    declaredAdult: boolean,
  ): Promise<AdultEligibilityEvidence>
  createFitnessId(
    command: CommandHeaders,
    attemptId: string,
    identity: PendingFitnessId,
  ): Promise<PendingFitnessId>
  declareBiologicalSex(
    command: CommandHeaders,
    attemptId: string,
    biologicalSex: BiologicalSex | null,
  ): Promise<BiologicalSex | null>
  declareTrainingGoal(command: CommandHeaders, goal: PrimaryTrainingGoal): Promise<ProfileClaim>
  declareFocusAreas(
    command: CommandHeaders,
    areas: readonly FocusArea[],
  ): Promise<readonly FocusArea[]>
  declareTrainingExperience(
    command: CommandHeaders,
    level: TrainingExperience,
  ): Promise<TrainingExperienceClaim>
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
  createFitnessId(identity: PendingFitnessId): Promise<PendingFitnessId>
  /**
   * Null declines. It still goes to the server, because the refusal has to be
   * recorded on the attempt or the screen would ask again on every cold start.
   */
  declareBiologicalSex(biologicalSex: BiologicalSex | null): Promise<BiologicalSex | null>
  /**
   * No attempt id travels: the claim is not part of the attempt, and the person
   * keeps editing it from their profile once the onboarding is closed.
   */
  declareTrainingGoal(goal: PrimaryTrainingGoal): Promise<ProfileClaim>
  /**
   * The whole emphasis, not one zone. Declaring replaces the set, so what the
   * person deselected is withdrawn by being absent rather than by a second call.
   */
  declareFocusAreas(areas: readonly FocusArea[]): Promise<readonly FocusArea[]>
  /**
   * One level, exclusive. Declaring again is a requalification rather than an edit:
   * the previous claim is sealed, so the level someone signed up with stays readable.
   */
  declareTrainingExperience(level: TrainingExperience): Promise<TrainingExperienceClaim>
  /** What was already answered, so coming back does not start over. */
  resume(): Promise<CurrentOnboardingAttempt>
}

export function createOnboardingFlow(dependencies: OnboardingFlowDependencies): OnboardingFlow {
  const issue = dependencies.newCommand
  let attempt: OnboardingAttempt | undefined
  let pendingAdult: { command: CommandHeaders; declaredAdult: boolean } | undefined
  let pendingIdentity: { command: CommandHeaders; identity: string } | undefined
  let pendingSex: { command: CommandHeaders; value: BiologicalSex | null } | undefined
  let pendingGoal: { command: CommandHeaders; value: PrimaryTrainingGoal } | undefined
  let pendingFocus: { command: CommandHeaders; value: string } | undefined
  let pendingExperience: { command: CommandHeaders; value: TrainingExperience } | undefined

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

    async createFitnessId(identity) {
      const open = await openAttempt()
      const answer = `${identity.given_name}\u0000${identity.family_name}\u0000${identity.username}`

      // The key belongs to the submission: a retry of the same answer replays,
      // and a corrected one is a different command that must not reuse it.
      if (!pendingIdentity || pendingIdentity.identity !== answer) {
        pendingIdentity = { command: issue(), identity: answer }
      }

      const created = await dependencies.transport.createFitnessId(
        pendingIdentity.command,
        open.id,
        identity,
      )
      pendingIdentity = undefined
      return created
    },

    async declareBiologicalSex(biologicalSex) {
      const open = await openAttempt()

      // Same discipline as the other steps: the key belongs to the submission, so
      // changing the answer starts a new one instead of reusing a burnt key.
      if (!pendingSex || pendingSex.value !== biologicalSex) {
        pendingSex = { command: issue(), value: biologicalSex }
      }

      const declared = await dependencies.transport.declareBiologicalSex(
        pendingSex.command,
        open.id,
        biologicalSex,
      )
      pendingSex = undefined
      return declared
    },

    async declareTrainingGoal(goal) {
      // Same discipline as the other steps, and no attempt is opened for it: the
      // claim stands on its own, so a person editing it later needs no attempt.
      if (!pendingGoal || pendingGoal.value !== goal) {
        pendingGoal = { command: issue(), value: goal }
      }

      const claim = await dependencies.transport.declareTrainingGoal(pendingGoal.command, goal)
      pendingGoal = undefined
      return claim
    },

    async declareFocusAreas(areas) {
      // The key follows the set, not the call: a retry of the same emphasis
      // replays, and changing a zone is a different command rather than a replay
      // of the old one under a key the server already answered.
      const identity = setIdentity(areas)
      if (!pendingFocus || pendingFocus.value !== identity) {
        pendingFocus = { command: issue(), value: identity }
      }

      const declared = await dependencies.transport.declareFocusAreas(pendingFocus.command, areas)
      pendingFocus = undefined
      return declared
    },

    async declareTrainingExperience(level) {
      // The same discipline as every other step, and no attempt is opened for it:
      // the claim stands on its own, so editing it later needs no attempt.
      if (!pendingExperience || pendingExperience.value !== level) {
        pendingExperience = { command: issue(), value: level }
      }

      const claim = await dependencies.transport.declareTrainingExperience(
        pendingExperience.command,
        level,
      )
      pendingExperience = undefined
      return claim
    },

    async resume() {
      const current = await dependencies.transport.readCurrent()
      // Reuse what the server already has rather than opening a second attempt.
      if (current.attempt) attempt = current.attempt
      return current
    },
  }
}

/** Order must not make two identical emphases look like different commands. */
function setIdentity(areas: readonly FocusArea[]): string {
  return [...areas].sort().join(',')
}
