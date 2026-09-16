/**
 * Allfit's own plans: `NEW-PAY-PLATFORM-PLAN`, `OP-PAY-017` and `OP-PAY-024..026`.
 *
 * `HU-BO-025` and `HU-BO-026`. The shapes are repeated here only so a malformed request
 * is answered 422 before it reaches the database. What makes the catalogue safe — a
 * published version never changes, somebody other than the proposer publishes, a
 * version declares every function in the catalogue and no privacy function can be in
 * it — is decided in PostgreSQL.
 *
 * Nothing in this domain charges anybody yet. Payments reflects the state of a payment;
 * it never processes one.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type PlatformPlanCatalogue = AllfitV1Schemas['PlatformPlanCatalogue']
export type PlatformPlan = AllfitV1Schemas['PlatformPlan']
export type PlatformPlanCreate = AllfitV1Schemas['PlatformPlanCreate']
export type PlatformPlanVersionProposal = AllfitV1Schemas['PlatformPlanVersionProposal']
export type PlatformPlanFeatureLimit = AllfitV1Schemas['PlatformPlanFeatureLimit']
export type PlatformPlanKind = AllfitV1Schemas['PlatformPlanKind']
export type PlatformPlanBillingPeriod = AllfitV1Schemas['PlatformPlanBillingPeriod']

export const PLATFORM_PLAN_KINDS: readonly PlatformPlanKind[] = ['free', 'paid']
export const PLATFORM_PLAN_BILLING_PERIODS: readonly PlatformPlanBillingPeriod[] = ['month', 'year']
export const PLATFORM_PLAN_CODE = /^[a-z][a-z0-9_]{1,39}$/
export const PLATFORM_FEATURE_CODE = /^[a-z][a-z0-9_]{1,63}$/
export const CURRENCY_CODE = /^[A-Z]{3}$/
export const MAX_PLAN_NAME = 80
export const MAX_AMOUNT_MINOR = 100_000_000_000
export const MAX_FEATURE_LIMIT = 2_147_483_647
export const MAX_FEATURES = 200

export interface PaymentsCommandContext {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
  requestId: string
}

export interface PaymentsCommandResult<T> {
  resource: T
  replayed: boolean
}

export interface PlatformPlanOperator {
  actorPersonId: string
  actorSessionId: string
}

export type PlatformPlanResult = PaymentsCommandResult<PlatformPlan>

type Command<T> = PaymentsCommandContext & PlatformPlanOperator & T

export interface PlatformPlanDatabase {
  list(input: PlatformPlanOperator & { requestId: string }): Promise<PlatformPlanCatalogue>
  create(input: Command<{ plan: PlatformPlanCreate }>): Promise<PlatformPlanResult>
  propose(
    input: Command<{ planId: string; proposal: PlatformPlanVersionProposal }>,
  ): Promise<PlatformPlanResult>
  publish(input: Command<{ planId: string; versionId: string }>): Promise<PlatformPlanResult>
  withdraw(input: Command<{ planId: string; versionId: string }>): Promise<PlatformPlanResult>
}
