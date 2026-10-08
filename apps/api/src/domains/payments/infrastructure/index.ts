/**
 * PostgreSQL access for Allfit's own plans.
 *
 * Every call runs as the support actor inside one transaction; the functions resolve
 * the duty from the session they are given, so this layer cannot widen what an operator
 * may do.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  PlatformPlan,
  PlatformPlanCatalogue,
  PlatformPlanDatabase,
  PlatformPlanResult,
} from '../domain/index.js'

type ListRow = { list_platform_plans: PlatformPlanCatalogue }
type CommandRow = { result: PlatformPlan; replayed: boolean }

export function createPlatformPlanDatabase(): PlatformPlanDatabase {
  const sql = database()

  return {
    list: (input) =>
      asSupport(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const [row] = await transaction<ListRow[]>`
          select payments.list_platform_plans(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the platform plans')
        return row.list_platform_plans
      }),

    create: (input) =>
      asSupport(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from payments.create_platform_plan(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.plan.code}, ${input.plan.name}, ${input.plan.plan_kind},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'create the plan')
      }),

    propose: (input) =>
      asSupport(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from payments.propose_platform_plan_version(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid, ${input.planId}::uuid,
            ${input.proposal.amount_minor}::bigint, ${input.proposal.currency_code},
            ${input.proposal.billing_period}, ${JSON.stringify(input.proposal.features)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'propose the plan version')
      }),

    publish: (input) =>
      asSupport(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from payments.publish_platform_plan_version(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.planId}::uuid, ${input.versionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'publish the plan version')
      }),

    withdraw: (input) =>
      asSupport(sql, input.actorPersonId, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow[]>`
          select * from payments.withdraw_platform_plan_version(
            ${input.actorPersonId}::uuid, ${input.actorSessionId}::uuid,
            ${input.planId}::uuid, ${input.versionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'withdraw the plan version')
      }),
  }
}

function result(rows: CommandRow[], operation: string): PlatformPlanResult {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

function asSupport<T>(
  sql: ReturnType<typeof database>,
  actorPersonId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const outcome = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'support', true),
               set_config('app.actor_person_id', ${actorPersonId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return outcome.value
  })
}
