/**
 * PostgreSQL access for a person's meals.
 *
 * The transaction starts without a person: the functions resolve the token's subject and
 * establish the actor themselves, because the API cannot know who the subject is before the
 * database says so. The items travel as one JSON document so the meal is written whole.
 *
 * That document is cast through `text`: a string parameter cast straight to `jsonb` is
 * serialized again by the driver and arrives as a JSON string, not as the array it holds.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureRequestPhase } from '../../../platform/observability/index.js'
import type {
  MealDatabase,
  MealDeletion,
  MealRecord,
  MealRecordPage,
  MealResult,
} from '../domain/meals.js'

const PROVIDER = 'workos'

type CommandRow<T> = { result: T; replayed: boolean }

export function createMealDatabase(): MealDatabase {
  const sql = database()

  return {
    list: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const [row] = await transaction<{ list_meals: MealRecordPage }[]>`
          select nutrition.list_meals(
            ${PROVIDER}, ${input.issuer}, ${input.subject},
            ${input.from}::date, ${input.to}::date, ${input.limit},
            ${input.before?.occurredAt ?? null}::timestamptz, ${input.before?.id ?? null}::uuid
          )
        `
        if (!row) throw new Error('PostgreSQL did not read the meals')
        return row.list_meals
      }),

    record: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<MealRecord>[]>`
          select * from nutrition.record_meal(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.mealId}::uuid,
            ${input.meal.occurred_at}::timestamptz, ${input.meal.timezone},
            ${input.meal.meal_type}, ${input.meal.note}::text,
            ${JSON.stringify(input.meal.items)}::text::jsonb, ${input.idempotencyKey}::uuid,
            ${input.requestHash}
          )
        `
        return result(rows, 'record the meal')
      }),

    delete: (input) =>
      withinRequest(sql, input.requestId, async (transaction) => {
        const rows = await transaction<CommandRow<MealDeletion>[]>`
          select * from nutrition.delete_meal(
            ${PROVIDER}, ${input.issuer}, ${input.subject}, ${input.mealId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return result(rows, 'delete the meal')
      }),
  }
}

function result<T>(rows: CommandRow<T>[], operation: string): MealResult<T> {
  const [row] = rows
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

function withinRequest<T>(
  sql: ReturnType<typeof database>,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureRequestPhase('business-db', async () => {
    const outcome = await sql.begin(async (transaction) => {
      await transaction`select set_config('app.request_id', ${requestId}, true)`
      return { value: await operation(transaction) }
    })
    return outcome.value
  })
}
