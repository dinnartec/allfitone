/**
 * Resolving a Space token to the person behind it.
 *
 * Every Space surface needs this and only identity may do it: `sub` is resolved
 * against `identity.access_accounts` **in the database**, and no domain identifier
 * ever travels in a token. Other domains reach it through this domain's public
 * interface rather than resolving people themselves.
 *
 * It lives on its own rather than on the onboarding service because it long outlives
 * the onboarding: the screens that use it run months after the last question was
 * answered.
 */

import type { AccountActor } from '../domain/index.js'

export interface SpaceActorAccounts {
  resolveOrCreateAccount(issuer: string, subject: string): Promise<AccountActor>
}

export class SpaceActorError extends Error {
  constructor(readonly code: 'registration-incomplete') {
    super(code)
    this.name = 'SpaceActorError'
  }
}

export interface SpaceActorResolver {
  /** The account behind the token, with its person when the Fitness ID is activated. */
  actorFor(subject: string): Promise<AccountActor>
  /**
   * The person behind the token. Everything in planning is keyed on the person, and
   * an account without one has not activated yet — which is a precondition, not a
   * failure to look something up.
   */
  personFor(subject: string): Promise<string>
}

export function createSpaceActorResolver(dependencies: {
  accounts: SpaceActorAccounts
  issuer: string
}): SpaceActorResolver {
  const actorFor = (subject: string) =>
    dependencies.accounts.resolveOrCreateAccount(dependencies.issuer, subject)

  return {
    actorFor,
    async personFor(subject) {
      const actor = await actorFor(subject)
      if (!actor.personId) throw new SpaceActorError('registration-incomplete')
      return actor.personId
    },
  }
}
