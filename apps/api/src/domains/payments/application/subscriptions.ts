/**
 * Subscription use cases — data in, data out.
 *
 * Thin on purpose, and it should stay thin. Every rule worth having lives either in the
 * closed database functions or in the row policies: who may suspend, whether a version is
 * still on offer, whether the gym can be paid, and what a suspension is allowed to touch.
 * A check repeated here would be a second place to forget it.
 *
 * The only thing this layer adds is the actor, which the handler resolved from a session
 * and which no caller gets to name for itself.
 */

import type {
  OrganizationPlanOffer,
  OrganizationSubscription,
  Page,
  PlanOfferCursor,
  Subscription,
  SubscriptionCheckoutResult,
  SubscriptionCursor,
  SubscriptionDatabase,
  SubscriptionStatus,
  SubscriptionTransitionResult,
} from '../domain/subscriptions.js'
import type { PaymentsCommandContext } from '../domain/index.js'

type Command = PaymentsCommandContext

export interface SubscriptionService {
  listOrganizationPlans(
    personId: string,
    input: {
      organizationId: string
      limit: number
      requestId: string
    } & Partial<PlanOfferCursor>,
  ): Promise<Page<OrganizationPlanOffer>>
  subscribe(
    personId: string,
    input: Command & { planVersionId: string; requestId: string },
  ): Promise<SubscriptionCheckoutResult>
  readMine(personId: string, input: { requestId: string }): Promise<Subscription[]>
  cancel(
    personId: string,
    input: Command & { subscriptionId: string; requestId: string },
  ): Promise<SubscriptionTransitionResult>
  listOrganizationSubscriptions(
    personId: string,
    input: {
      organizationId: string
      status?: SubscriptionStatus
      limit: number
      requestId: string
    } & Partial<SubscriptionCursor>,
  ): Promise<Page<OrganizationSubscription>>
  suspend(
    personId: string,
    input: Command & { organizationId: string; subscriptionId: string; requestId: string },
  ): Promise<SubscriptionTransitionResult>
  reactivate(
    personId: string,
    input: Command & { organizationId: string; subscriptionId: string; requestId: string },
  ): Promise<SubscriptionTransitionResult>
  end(
    personId: string,
    input: Command & { organizationId: string; subscriptionId: string; requestId: string },
  ): Promise<SubscriptionTransitionResult>
}

export function createSubscriptionService(database: SubscriptionDatabase): SubscriptionService {
  return {
    listOrganizationPlans: (personId, input) =>
      database.listOrganizationPlans({ personId, ...input }),
    subscribe: (personId, input) => database.subscribe({ personId, ...input }),
    readMine: (personId, input) => database.readMine({ personId, ...input }),
    cancel: (personId, input) => database.cancel({ personId, ...input }),
    listOrganizationSubscriptions: (personId, input) =>
      database.listOrganizationSubscriptions({ personId, ...input }),
    suspend: (personId, input) => database.suspend({ personId, ...input }),
    reactivate: (personId, input) => database.reactivate({ personId, ...input }),
    end: (personId, input) => database.end({ personId, ...input }),
  }
}
