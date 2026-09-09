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
export type TrainingDiscipline = AllfitV1Schemas['TrainingDiscipline']
export type TrainingDisciplineClaim = AllfitV1Schemas['SpaceTrainingDisciplineClaim']
export type BodyProgressDeclaration = AllfitV1Schemas['SpaceBodyProgressDeclaration']
export type BodyProgressRecord = AllfitV1Schemas['SpaceBodyProgressRecord']
export type BodyMetric = AllfitV1Schemas['BodyMetric']
export type OnboardingCompletion = AllfitV1Schemas['SpaceOnboardingCompletion']
export type ActivatedPerson = AllfitV1Schemas['SpaceActivatedPerson']

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
  declareTrainingDiscipline(
    command: CommandHeaders,
    discipline: TrainingDiscipline,
  ): Promise<TrainingDisciplineClaim>
  declareTrainingExperience(
    command: CommandHeaders,
    level: TrainingExperience,
  ): Promise<TrainingExperienceClaim>
  recordBodyProgress(
    command: CommandHeaders,
    declaration: BodyProgressDeclaration,
  ): Promise<BodyProgressRecord>
  /** No command headers: the skip's primary key is the whole idempotency. */
  skipStep(attemptId: string, stepCode: string): Promise<void>
  complete(
    command: CommandHeaders,
    attemptId: string,
    completion: OnboardingCompletion,
  ): Promise<ActivatedPerson>
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
  declareTrainingDiscipline(discipline: TrainingDiscipline): Promise<TrainingDisciplineClaim>
  declareTrainingExperience(level: TrainingExperience): Promise<TrainingExperienceClaim>
  /**
   * One measurement. Weight and height are two calls with two keys, because
   * `OP-IDN-006` makes the record's id the command's own — and because they are
   * independent measurements that will later be updated apart.
   */
  recordBodyProgress(declaration: BodyProgressDeclaration): Promise<BodyProgressRecord>
  /** Skipping a step, which needs an open attempt and so opens one if there is none. */
  skipStep(stepCode: string): Promise<void>
  /**
   * Closes the onboarding and activates the Fitness ID. The person already exists in
   * `pending_activation`; this is the only path that takes it to `active`, and a
   * retry answers the same one rather than making a second.
   */
  activate(completion: OnboardingCompletion): Promise<ActivatedPerson>
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
  let pendingDiscipline: { command: CommandHeaders; value: TrainingDiscipline } | undefined
  let pendingExperience: { command: CommandHeaders; value: TrainingExperience } | undefined
  // One pending command per metric: they are two commands, so one key each.
  const pendingMeasures = new Map<BodyMetric, { command: CommandHeaders; value: string }>()
  let pendingActivation: CommandHeaders | undefined

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

    async declareTrainingDiscipline(discipline) {
      // The same discipline as every other step, and the pun is not the reason: the
      // key belongs to the submission, so a retry replays and a change of mind is a
      // new command rather than a replay under a key the server already answered.
      if (!pendingDiscipline || pendingDiscipline.value !== discipline) {
        pendingDiscipline = { command: issue(), value: discipline }
      }

      const claim = await dependencies.transport.declareTrainingDiscipline(
        pendingDiscipline.command,
        discipline,
      )
      pendingDiscipline = undefined
      return claim
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

    async recordBodyProgress(declaration) {
      // The key follows the measurement, not the call: retrying the same number
      // replays, and changing it is a different command rather than a replay under a
      // key the server already answered.
      const identity = `${declaration.value} ${declaration.unit} ${declaration.measured_on}`
      const pending = pendingMeasures.get(declaration.metric_code)
      const command = pending && pending.value === identity ? pending.command : issue()
      pendingMeasures.set(declaration.metric_code, { command, value: identity })

      const record = await dependencies.transport.recordBodyProgress(command, declaration)
      pendingMeasures.delete(declaration.metric_code)
      return record
    },

    async skipStep(stepCode) {
      const open = await openAttempt()
      await dependencies.transport.skipStep(open.id, stepCode)
    },

    async activate(completion) {
      const open = await openAttempt()
      // The key is held across retries and never renewed: a second key would be a
      // second command, and this is the one command that must not run twice.
      pendingActivation ??= issue()
      const person = await dependencies.transport.complete(pendingActivation, open.id, completion)
      pendingActivation = undefined
      return person
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
