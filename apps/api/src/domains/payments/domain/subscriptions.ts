/**
 * The paying bond between a person and an organization — `OP-PAY-007..015`.
 *
 * The shapes are repeated from the contract only so a malformed request is answered 422
 * before it reaches the database. Everything that makes a subscription safe is decided in
 * PostgreSQL: that a published price never moves, that a coach never reads who pays, that
 * nothing ends without a declared human actor, and that suspending opens a reversible
 * cause instead of revoking a permission.
 *
 * There is no authorization branch in this file or the one above it. `manage_billing`,
 * whether the caller is a client of that gym, and whether the gym can be paid at all are
 * resolved inside each command's own transaction, where they cannot drift from the row
 * policies that enforce the same thing.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type { PaymentsCommandContext, PaymentsCommandResult } from './index.js'

export type SubscriptionStatus = AllfitV1Schemas['SubscriptionStatus']
export type OrganizationPlanOffer = AllfitV1Schemas['OrganizationPlanOffer']
export type SubscriptionCheckout = AllfitV1Schemas['SubscriptionCheckout']
export type SubscriptionTransition = AllfitV1Schemas['SubscriptionTransition']
export type Subscription = AllfitV1Schemas['Subscription']
export type OrganizationSubscription = AllfitV1Schemas['OrganizationSubscription']

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['active', 'suspended', 'ended']

export const PLAN_PAGE_LIMIT = { default: 50, max: 100 } as const

/**
 * A page and the keyset that produced it, kept apart from the presented cursor.
 *
 * The handler encodes the cursor and this layer never sees the encoded form, because a
 * cursor is a presentation concern: the database is given the three sort values and
 * nothing else.
 */
export interface Page<T> {
  items: T[]
  hasMore: boolean
}

export interface PlanOfferCursor {
  cursorAmountMinor: number
  cursorVersionId: string
}

export interface SubscriptionCursor {
  cursorStatus: SubscriptionStatus
  cursorStartedAt: string
  cursorSubscriptionId: string
}

/** Who is acting, resolved from the session before anything is read. */
export interface PayingPerson {
  personId: string
  requestId: string
}

type PersonCommand<T> = PaymentsCommandContext & { personId: string } & T
type StudioCommand<T> = PaymentsCommandContext & {
  personId: string
  organizationId: string
} & T

export type SubscriptionCheckoutResult = PaymentsCommandResult<SubscriptionCheckout>
export type SubscriptionTransitionResult = PaymentsCommandResult<SubscriptionTransition>

export interface SubscriptionDatabase {
  listOrganizationPlans(
    input: PayingPerson & {
      organizationId: string
      limit: number
    } & Partial<PlanOfferCursor>,
  ): Promise<Page<OrganizationPlanOffer>>
  subscribe(
    input: PersonCommand<{ planVersionId: string; requestId: string }>,
  ): Promise<SubscriptionCheckoutResult>
  readMine(input: PayingPerson): Promise<Subscription[]>
  cancel(
    input: PersonCommand<{ subscriptionId: string; requestId: string }>,
  ): Promise<SubscriptionTransitionResult>
  listOrganizationSubscriptions(
    input: PayingPerson & {
      organizationId: string
      status?: SubscriptionStatus
      limit: number
    } & Partial<SubscriptionCursor>,
  ): Promise<Page<OrganizationSubscription>>
  suspend(
    input: StudioCommand<{ subscriptionId: string; requestId: string }>,
  ): Promise<SubscriptionTransitionResult>
  reactivate(
    input: StudioCommand<{ subscriptionId: string; requestId: string }>,
  ): Promise<SubscriptionTransitionResult>
  end(
    input: StudioCommand<{ subscriptionId: string; requestId: string }>,
  ): Promise<SubscriptionTransitionResult>
}
