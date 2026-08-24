/**
 * Onboarding, shared by every surface that activates a person.
 *
 * It carries `OP-IDN-001` to `OP-IDN-003`: open an attempt, record the adult
 * declaration, create the `PERSON`. Space and Studio both use it, and they must:
 * `OP-IDN-003` is the only path that creates a person, and a Fitness ID is one
 * per person (DT-002), so a second implementation would be a second way to end
 * up with two identities for the same human.
 *
 * What differs between the surfaces is not the rule but how the actor is found.
 * Studio arrives with an opaque session cookie that has already been resolved.
 * Space arrives with a bearer token and nothing else, so the account is derived
 * from `(issuer, subject)` first — the mandatory filter `OP-IDN-001` names.
 *
 * The issuer is configured rather than read from the token. Accepting a subject
 * alongside an issuer the caller supplied would let somebody aim a command at an
 * account that is not theirs.
 *
 * Everything past activation — goals, body, disciplines for Space; credentials
 * and organizations for Studio — is a different operation entirely and does not
 * belong here.
 */

import type { AuthenticatedIdentity, VerifiedToken } from '@allfitone/auth-provider'
import { hashInvitationToken } from '@allfitone/notifications'

import type {
  AccessAccount,
  AccountActor,
  AdultEligibilityEvidence,
  BiologicalSex,
  CommandContext,
  CurrentOnboardingAttempt,
  FocusArea,
  IdentityOnboardingDatabase,
  OnboardingAttempt,
  PendingFitnessId,
  PrimaryTrainingGoal,
  ProfileClaim,
} from '../domain/index.js'

export interface OnboardingService {
  startAttempt(
    actor: AccountActor,
    input: CommandContext & { invitationToken?: string },
  ): Promise<OnboardingAttempt>
  recordAdultEligibility(
    actor: AccountActor,
    input: CommandContext & { attemptId: string; declaredAdult: boolean },
  ): Promise<AdultEligibilityEvidence>
  createFitnessId(
    actor: AccountActor,
    input: CommandContext & {
      attemptId: string
      givenName: string
      familyName: string
      username: string
      contactEmail: string
      contactEmailVerified: boolean
    },
  ): Promise<PendingFitnessId>
  declareBiologicalSex(
    actor: AccountActor,
    input: CommandContext & { attemptId: string; biologicalSex: BiologicalSex | null },
  ): Promise<BiologicalSex | null>
  declareProfileClaim(
    actor: AccountActor,
    input: CommandContext & {
      attributeCode: 'primary_training_goal'
      valueText: PrimaryTrainingGoal
    },
  ): Promise<ProfileClaim>
  declareFocusAreas(
    actor: AccountActor,
    input: CommandContext & { areas: readonly FocusArea[] },
  ): Promise<readonly FocusArea[]>
  readCurrentAttempt(actor: AccountActor): Promise<CurrentOnboardingAttempt>
  complete(
    actor: AccountActor,
    input: Omit<Parameters<IdentityOnboardingDatabase['activatePerson']>[0], 'accountId'>,
  ): Promise<string>
}

export function createOnboardingService(database: IdentityOnboardingDatabase): OnboardingService {
  return {
    startAttempt: (actor, input) => {
      const { invitationToken, ...command } = input
      return database.startAttempt({
        accountId: actor.accountId,
        ...command,
        ...(invitationToken ? { invitationTokenHash: hashInvitationToken(invitationToken) } : {}),
      })
    },
    recordAdultEligibility: (actor, input) =>
      database.recordAdultEligibility({ accountId: actor.accountId, ...input }),
    createFitnessId: (actor, input) =>
      database.createPendingPerson({ accountId: actor.accountId, ...input }),
    declareBiologicalSex: (actor, input) =>
      database.declareBiologicalSex({ accountId: actor.accountId, ...input }),
    declareProfileClaim: (actor, input) =>
      database.declareProfileClaim({ accountId: actor.accountId, ...input }),
    declareFocusAreas: (actor, input) =>
      database.declareFocusAreas({ accountId: actor.accountId, ...input }),
    readCurrentAttempt: (actor) => database.readCurrentAttempt(actor.accountId),
    complete: (actor, input) => database.activatePerson({ accountId: actor.accountId, ...input }),
  }
}

/**
 * Refusing a Fitness ID because the credential's address is not verified.
 *
 * The contact email is the same datum as the sign-in email (DT-016), and a
 * contact we cannot prove must never be recorded as verified — nothing would
 * satisfy the "verified contact" filter every notification depends on.
 */
export class OnboardingPreconditionError extends Error {
  constructor(readonly code: 'forbidden') {
    super(code)
    this.name = 'OnboardingPreconditionError'
  }
}

/** Only what the Space path needs from the identity provider. */
export interface ProviderIdentityReader {
  identityFor(subject: string): Promise<AuthenticatedIdentity>
}

/** Only what the Space path needs from the session database. */
export interface AccountResolver {
  resolveOrCreateAccount(issuer: string, subject: string): Promise<AccessAccount>
}

export interface SpaceOnboardingService {
  startAttempt(token: VerifiedToken, command: CommandContext): Promise<OnboardingAttempt>
  recordAdultEligibility(
    token: VerifiedToken,
    input: CommandContext & { attemptId: string; declaredAdult: boolean },
  ): Promise<AdultEligibilityEvidence>
  createFitnessId(
    token: VerifiedToken,
    input: CommandContext & {
      attemptId: string
      givenName: string
      familyName: string
      username: string
    },
  ): Promise<PendingFitnessId>
  declareBiologicalSex(
    token: VerifiedToken,
    input: CommandContext & { attemptId: string; biologicalSex: BiologicalSex | null },
  ): Promise<BiologicalSex | null>
  declareProfileClaim(
    token: VerifiedToken,
    input: CommandContext & {
      attributeCode: 'primary_training_goal'
      valueText: PrimaryTrainingGoal
    },
  ): Promise<ProfileClaim>
  declareFocusAreas(
    token: VerifiedToken,
    input: CommandContext & { areas: readonly FocusArea[] },
  ): Promise<readonly FocusArea[]>
  readCurrentAttempt(token: VerifiedToken): Promise<CurrentOnboardingAttempt>
}

export interface SpaceOnboardingDependencies {
  accounts: AccountResolver
  onboarding: OnboardingService
  provider: ProviderIdentityReader
  issuer: string
}

export function createSpaceOnboardingService(
  dependencies: SpaceOnboardingDependencies,
): SpaceOnboardingService {
  const actorFor = async (token: VerifiedToken): Promise<AccountActor> => {
    const account = await dependencies.accounts.resolveOrCreateAccount(
      dependencies.issuer,
      token.subject,
    )
    return {
      accountId: account.accountId,
      ...(account.personId ? { personId: account.personId } : {}),
    }
  }

  return {
    async startAttempt(token, command) {
      return dependencies.onboarding.startAttempt(await actorFor(token), command)
    },
    async recordAdultEligibility(token, input) {
      return dependencies.onboarding.recordAdultEligibility(await actorFor(token), input)
    },
    async createFitnessId(token, input) {
      // The address is the provider's fact, never the client's: a client-supplied
      // one recorded as verified would be a contact nobody proved.
      const identity = await dependencies.provider.identityFor(token.subject)
      if (!identity.verifiedEmail) throw new OnboardingPreconditionError('forbidden')

      return dependencies.onboarding.createFitnessId(await actorFor(token), {
        ...input,
        contactEmail: identity.verifiedEmail,
        contactEmailVerified: true,
      })
    },
    async declareProfileClaim(token, input) {
      return dependencies.onboarding.declareProfileClaim(await actorFor(token), input)
    },

    async declareFocusAreas(token, input) {
      return dependencies.onboarding.declareFocusAreas(await actorFor(token), input)
    },

    async declareBiologicalSex(token, input) {
      return dependencies.onboarding.declareBiologicalSex(await actorFor(token), input)
    },
    async readCurrentAttempt(token) {
      return dependencies.onboarding.readCurrentAttempt(await actorFor(token))
    },
  }
}
