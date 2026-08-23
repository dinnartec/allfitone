/**
 * Starting an onboarding from a Space bearer token.
 *
 * Studio arrives with an opaque cookie already resolved to an account; Space
 * arrives with a token and nothing else, so the account has to be derived from
 * `(issuer, subject)` before any command runs. `OP-IDN-001` names that as its
 * mandatory filter, and it is the only thing the Space path adds — the commands
 * themselves are the shared ones, because `OP-IDN-003` is the single path that
 * creates a person.
 *
 * The issuer is configured, never taken from the token. A subject paired with an
 * issuer the caller chose would let somebody address an account that is not
 * theirs.
 */

import { describe, expect, test } from 'bun:test'
import type { AuthenticatedIdentity, VerifiedToken } from '@allfitone/auth-provider'

import type { AdultEligibilityEvidence, OnboardingAttempt } from '../domain/index.js'
import {
  createSpaceOnboardingService,
  OnboardingPreconditionError,
  type OnboardingService,
} from './onboarding.js'

const ISSUER = 'https://api.workos.test/user_management/client_space'
const TOKEN: VerifiedToken = { subject: 'user_01', sessionId: 'sid_01', surface: 'space' }
const COMMAND = {
  idempotencyKey: '52222222-2222-4222-8222-222222222221',
  commandId: '0198e200-0000-7000-8000-000000000002',
  requestHash: new Uint8Array(32),
}
const ATTEMPT: OnboardingAttempt = {
  id: 'attempt_01',
  status: 'open',
  eligibilityStatus: 'pending',
  expiresAt: new Date('2026-08-18T00:00:00.000Z'),
}
const PROVIDER_IDENTITY: AuthenticatedIdentity = {
  givenName: 'Ada',
  familyName: 'Lovelace',
  verifiedEmail: 'ada@example.test',
}
const EVIDENCE: AdultEligibilityEvidence = {
  result: 'pass',
  evaluatedAt: new Date('2026-08-17T00:00:00.000Z'),
}

function serviceWith(
  overrides: Partial<OnboardingService> = {},
  providerIdentity: AuthenticatedIdentity = PROVIDER_IDENTITY,
) {
  const resolved: Array<{ issuer: string; subject: string }> = []
  const actors: string[] = []
  const contacts: Array<{ contactEmail: string; contactEmailVerified: boolean }> = []
  const subjects: string[] = []

  const onboarding: OnboardingService = {
    startAttempt: async (actor) => {
      actors.push(actor.accountId)
      return ATTEMPT
    },
    recordAdultEligibility: async (actor) => {
      actors.push(actor.accountId)
      return EVIDENCE
    },
    createFitnessId: async (actor, input) => {
      actors.push(actor.accountId)
      contacts.push({
        contactEmail: input.contactEmail,
        contactEmailVerified: input.contactEmailVerified,
      })
      return { givenName: input.givenName, familyName: input.familyName, username: input.username }
    },
    declareBiologicalSex: async (actor, input) => {
      actors.push(actor.accountId)
      return input.biologicalSex
    },
    readCurrentAttempt: async (actor) => {
      actors.push(actor.accountId)
      return { attempt: ATTEMPT, identity: null, biologicalSex: null, biologicalSexAnswered: false }
    },
    complete: async () => 'person_01',
    ...overrides,
  }

  const service = createSpaceOnboardingService({
    accounts: {
      resolveOrCreateAccount: async (issuer, subject) => {
        resolved.push({ issuer, subject })
        return { accountId: 'account_01' }
      },
    },
    onboarding,
    provider: {
      identityFor: async (subject) => {
        subjects.push(subject)
        return providerIdentity
      },
    },
    issuer: ISSUER,
  })

  return { service, resolved, actors, contacts, subjects }
}

describe('createSpaceOnboardingService', () => {
  test('derives the account from the configured issuer and the token subject', async () => {
    const { service, resolved } = serviceWith()

    await service.startAttempt(TOKEN, COMMAND)

    expect(resolved).toEqual([{ issuer: ISSUER, subject: 'user_01' }])
  })

  test('runs the command against the resolved account, not against the token', async () => {
    const { service, actors } = serviceWith()

    await service.startAttempt(TOKEN, COMMAND)

    expect(actors).toEqual(['account_01'])
  })

  test('returns the attempt so a repeat converges on the same one', async () => {
    const { service } = serviceWith()

    await expect(service.startAttempt(TOKEN, COMMAND)).resolves.toEqual(ATTEMPT)
  })

  test('records the declaration against the same account', async () => {
    const { service, actors, resolved } = serviceWith()

    const evidence = await service.recordAdultEligibility(TOKEN, {
      ...COMMAND,
      attemptId: ATTEMPT.id,
      declaredAdult: true,
    })

    expect(evidence).toEqual(EVIDENCE)
    expect(actors).toEqual(['account_01'])
    expect(resolved).toHaveLength(1)
  })

  test('passes the declaration through unchanged, including a refusal', async () => {
    const seen: boolean[] = []
    const { service } = serviceWith({
      recordAdultEligibility: async (_actor, input) => {
        seen.push(input.declaredAdult)
        return { result: 'fail', evaluatedAt: EVIDENCE.evaluatedAt }
      },
    })

    await service.recordAdultEligibility(TOKEN, {
      ...COMMAND,
      attemptId: ATTEMPT.id,
      declaredAdult: false,
    })

    expect(seen).toEqual([false])
  })
})

describe('the contact email of a new Fitness ID', () => {
  const INPUT = {
    ...COMMAND,
    attemptId: 'attempt_01',
    givenName: 'Ada',
    familyName: 'Lovelace',
    username: 'ada_lovelace',
  }

  test('is the credential address the provider confirmed, looked up by subject', async () => {
    const { service, contacts, subjects } = serviceWith()

    await service.createFitnessId(TOKEN, INPUT)

    expect(subjects).toEqual([TOKEN.subject])
    expect(contacts).toEqual([{ contactEmail: 'ada@example.test', contactEmailVerified: true }])
  })

  test('is never taken from the caller, even when the caller sends one', async () => {
    const { service, contacts } = serviceWith()

    // The signature does not accept a contact; the cast is what a client
    // sending extra JSON would look like once it reaches the use case.
    const hostile = { ...INPUT, contactEmail: 'attacker@example.test' }
    await service.createFitnessId(TOKEN, hostile as typeof INPUT)

    expect(contacts[0]?.contactEmail).toBe('ada@example.test')
  })

  test('refuses the command when the provider reports the address unverified', async () => {
    const { service, contacts } = serviceWith({}, { ...PROVIDER_IDENTITY, verifiedEmail: null })

    await expect(service.createFitnessId(TOKEN, INPUT)).rejects.toBeInstanceOf(
      OnboardingPreconditionError,
    )
    expect(contacts).toEqual([])
  })
})
