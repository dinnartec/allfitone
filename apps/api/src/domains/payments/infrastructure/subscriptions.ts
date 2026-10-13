/**
 * PostgreSQL access for subscriptions.
 *
 * Every call runs as the acting **person** inside one transaction. That is the whole
 * authorization story on this side: the closed functions resolve `manage_billing`, the
 * relationship and the gateway from that actor, and the row policies filter what comes
 * back. Nothing here can widen any of it, and nothing here passes an organization the
 * caller claimed without the function checking it.
 *
 * A page is read with `limit + 1` rows and trimmed, so `has_more` is a fact rather than a
 * guess. The extra row is dropped before it leaves this file.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  OrganizationPlanOffer,
  OrganizationSubscription,
  Page,
  Subscription,
  SubscriptionCheckout,
  SubscriptionCheckoutResult,
  SubscriptionDatabase,
  SubscriptionTransition,
  SubscriptionTransitionResult,
} from '../domain/subscriptions.js'

type PlanOfferRow = {
  plan_id: string
  plan_version_id: string
  plan_name: string
  version_number: number
  amount_minor: string
  currency_code: string
  billing_period: OrganizationPlanOffer['billing_period']
  published_at: string
}

type CheckoutRow = {
  subscription_id: string
  organization_id: string
  plan_version_id: string
  plan_name: string
  amount_minor: string
  currency_code: string
  billing_period: SubscriptionCheckout['billing_period']
  provider: SubscriptionCheckout['provider']
  started: boolean
  replayed: boolean
}

type SubscriptionRow = {
  subscription_id: string
  organization_id: string
  organization_name: string
  plan_name: string
  plan_version_id: string
  amount_minor: string
  currency_code: string
  billing_period: Subscription['billing_period']
  status: Subscription['status']
  current_period_end: string | null
  started_at: string
  suspended_at: string | null
  blocked_since: string | null
}

type OrganizationSubscriptionRow = {
  subscription_id: string
  person_id: string
  person_name: string
  plan_name: string
  plan_version_id: string
  amount_minor: string
  currency_code: string
  billing_period: OrganizationSubscription['billing_period']
  status: OrganizationSubscription['status']
  current_period_end: string | null
  started_at: string
  suspended_at: string | null
  ended_at: string | null
}

type TransitionRow = { subscription_id: string; status: SubscriptionTransition['status'] }

export function createSubscriptionDatabase(): SubscriptionDatabase {
  const sql = database()

  return {
    listOrganizationPlans: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<PlanOfferRow[]>`
          select * from payments.list_organization_plans(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.limit + 1}::integer,
            ${input.cursorAmountMinor ?? null}::bigint,
            ${input.cursorVersionId ?? null}::uuid
          )
        `
        return page(rows, input.limit, presentOffer)
      }),

    subscribe: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<CheckoutRow[]>`
          select * from payments.subscribe_to_plan(
            ${input.personId}::uuid, ${input.planVersionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return checkout(rows)
      }),

    readMine: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<SubscriptionRow[]>`
          select * from payments.read_my_subscriptions(${input.personId}::uuid)
        `
        return rows.map(presentSubscription)
      }),

    cancel: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<TransitionRow[]>`
          select subscription_id, status from payments.cancel_my_subscription(
            ${input.personId}::uuid, ${input.subscriptionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return transition(rows, 'cancel the subscription')
      }),

    listOrganizationSubscriptions: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<OrganizationSubscriptionRow[]>`
          select * from payments.list_organization_subscriptions(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.status ?? null}::payments.subscription_status,
            ${input.limit + 1}::integer,
            ${input.cursorStatus ?? null}::payments.subscription_status,
            ${input.cursorStartedAt ?? null}::timestamptz,
            ${input.cursorSubscriptionId ?? null}::uuid
          )
        `
        return page(rows, input.limit, presentOrganizationSubscription)
      }),

    suspend: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<TransitionRow[]>`
          select subscription_id, status from payments.suspend_subscription(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.subscriptionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return transition(rows, 'suspend the subscription')
      }),

    reactivate: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<TransitionRow[]>`
          select subscription_id, status from payments.reactivate_subscription(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.subscriptionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return transition(rows, 'reactivate the subscription')
      }),

    end: (input) =>
      asPerson(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<TransitionRow[]>`
          select subscription_id, status from payments.end_subscription(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.subscriptionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return transition(rows, 'end the subscription')
      }),
  }
}

function page<Row, Item>(rows: Row[], limit: number, present: (row: Row) => Item): Page<Item> {
  const hasMore = rows.length > limit
  return { items: rows.slice(0, limit).map(present), hasMore }
}

/**
 * `amount_minor` is `bigint`, which the driver hands over as a string so a value past
 * 2^53 does not quietly lose its last digits. Prices are well inside that, but reading it
 * as a number here is where the next currency with four decimal places would break.
 */
function presentOffer(row: PlanOfferRow): OrganizationPlanOffer {
  return {
    plan_id: row.plan_id,
    plan_version_id: row.plan_version_id,
    plan_name: row.plan_name,
    version_number: row.version_number,
    amount_minor: Number(row.amount_minor),
    currency_code: row.currency_code,
    billing_period: row.billing_period,
    published_at: new Date(row.published_at).toISOString(),
  }
}

function presentSubscription(row: SubscriptionRow): Subscription {
  return {
    subscription_id: row.subscription_id,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    plan_name: row.plan_name,
    plan_version_id: row.plan_version_id,
    amount_minor: Number(row.amount_minor),
    currency_code: row.currency_code,
    billing_period: row.billing_period,
    status: row.status,
    current_period_end: row.current_period_end,
    started_at: new Date(row.started_at).toISOString(),
    suspended_at: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
    blocked_since: row.blocked_since ? new Date(row.blocked_since).toISOString() : null,
  }
}

function presentOrganizationSubscription(
  row: OrganizationSubscriptionRow,
): OrganizationSubscription {
  return {
    subscription_id: row.subscription_id,
    person_id: row.person_id,
    person_name: row.person_name,
    plan_name: row.plan_name,
    plan_version_id: row.plan_version_id,
    amount_minor: Number(row.amount_minor),
    currency_code: row.currency_code,
    billing_period: row.billing_period,
    status: row.status,
    current_period_end: row.current_period_end,
    started_at: new Date(row.started_at).toISOString(),
    suspended_at: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  }
}

function checkout(rows: CheckoutRow[]): SubscriptionCheckoutResult {
  const [row] = rows
  if (!row) throw new Error('PostgreSQL did not create the subscription')
  return {
    resource: {
      subscription_id: row.subscription_id,
      organization_id: row.organization_id,
      plan_version_id: row.plan_version_id,
      plan_name: row.plan_name,
      amount_minor: Number(row.amount_minor),
      currency_code: row.currency_code,
      billing_period: row.billing_period,
      provider: row.provider,
    },
    replayed: row.replayed,
  }
}

function transition(rows: TransitionRow[], operation: string): SubscriptionTransitionResult {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return {
    resource: { subscription_id: row.subscription_id, status: row.status },
    // Every transition converges, so there is no separate replay flag to read: the
    // command either moved the state or found it already there, and both answer 200.
    replayed: false,
  }
}

function asPerson<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const outcome = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'person', true),
               set_config('app.actor_person_id', ${personId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return outcome.value
  })
}
