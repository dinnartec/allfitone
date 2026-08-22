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

import type { VerifiedToken } from '@allfitone/auth-provider'
import { hashInvitationToken } from '@allfitone/notifications'

import type {
  AccessAccount,
  AccountActor,
  AdultEligibilityEvidence,
  CommandContext,
  CurrentOnboardingAttempt,
  IdentityOnboardingDatabase,
  OnboardingAttempt,
  OnboardingIdentity,
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
  recordIdentity(
    actor: AccountActor,
    input: CommandContext & { attemptId: string } & OnboardingIdentity,
  ): Promise<OnboardingIdentity>
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
    recordIdentity: (actor, input) =>
      database.recordOnboardingIdentity({ accountId: actor.accountId, ...input }),
    readCurrentAttempt: (actor) => database.readCurrentAttempt(actor.accountId),
    complete: (actor, input) => database.activatePerson({ accountId: actor.accountId, ...input }),
  }
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
  recordIdentity(
    token: VerifiedToken,
    input: CommandContext & { attemptId: string } & OnboardingIdentity,
  ): Promise<OnboardingIdentity>
  readCurrentAttempt(token: VerifiedToken): Promise<CurrentOnboardingAttempt>
}

export interface SpaceOnboardingDependencies {
  accounts: AccountResolver
  onboarding: OnboardingService
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
    async recordIdentity(token, input) {
      return dependencies.onboarding.recordIdentity(await actorFor(token), input)
    },
    async readCurrentAttempt(token) {
      return dependencies.onboarding.readCurrentAttempt(await actorFor(token))
    },
  }
}
