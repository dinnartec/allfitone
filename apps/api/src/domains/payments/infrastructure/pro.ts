/**
 * PostgreSQL access for Allfit Pro.
 *
 * Reads and purchases run as the person they belong to, notifications as the worker; the
 * functions check that actor themselves, so this layer cannot let one person act for
 * another. The verified store state crosses as one JSON document in the database's own
 * vocabulary.
 */

import type { StoreSubscriptionState } from '@allfitone/store-billing'
import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  NotificationOutcome,
  ProDatabase,
  ProPayments,
  ProPlanCatalogue,
  ProStatus,
} from '../domain/pro.js'

function change(state: StoreSubscriptionState) {
  return {
    store: state.store,
    environment: state.environment,
    product_id: state.productId,
    subscription_ref: state.subscriptionRef,
    transaction_id: state.transactionId,
    account_token: state.accountToken,
    status: state.status,
    ended_reason: state.endedReason,
    auto_renews: state.autoRenews,
    current_period_end: state.currentPeriodEnd.toISOString(),
    grace_until: state.graceUntil?.toISOString() ?? null,
    observed_at: state.observedAt.toISOString(),
    amount_minor: state.amountMinor,
    currency_code: state.currencyCode,
  }
}

export function createProDatabase(): ProDatabase {
  const sql = database()

  return {
    read: (input) =>
      as(sql, 'person', input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ read_my_pro: ProStatus }[]>`
          select payments.read_my_pro(${input.personId}::uuid)
        `
        if (!row) throw new Error('PostgreSQL did not resolve Pro')
        return row.read_my_pro
      }),

    plans: (input) =>
      as(sql, 'person', input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ list_pro_plans: ProPlanCatalogue }[]>`
          select payments.list_pro_plans(${input.personId}::uuid)
        `
        if (!row) throw new Error('PostgreSQL did not list the plans')
        return row.list_pro_plans
      }),

    payments: (input) =>
      as(sql, 'person', input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ list_my_pro_payments: ProPayments }[]>`
          select payments.list_my_pro_payments(${input.personId}::uuid)
        `
        if (!row) throw new Error('PostgreSQL did not list the payments')
        return row.list_my_pro_payments
      }),

    recordPurchase: (input) =>
      as(sql, 'person', input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ result: ProStatus; replayed: boolean }[]>`
          select * from payments.record_store_subscription(
            ${input.personId}::uuid,
            ${JSON.stringify(change(input.state))}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        if (!row) throw new Error('PostgreSQL did not record the purchase')
        return { resource: row.result, replayed: row.replayed }
      }),

    applyNotification: (input) =>
      as(sql, 'worker', null, input.requestId, async (transaction) => {
        const [row] = await transaction<{ apply_store_notification: NotificationOutcome }[]>`
          select payments.apply_store_notification(
            ${input.store}, ${input.notificationId}, ${input.payloadHash},
            ${JSON.stringify(change(input.state))}::text::jsonb
          )
        `
        if (!row) throw new Error('PostgreSQL did not apply the notification')
        return row.apply_store_notification
      }),
  }
}

function as<T>(
  sql: ReturnType<typeof database>,
  kind: 'person' | 'worker',
  personId: string | null,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const outcome = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', ${kind}, true),
               set_config('app.actor_person_id', ${personId ?? ''}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return outcome.value
  })
}
