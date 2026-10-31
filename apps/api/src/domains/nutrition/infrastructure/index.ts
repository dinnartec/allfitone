/**
 * PostgreSQL access for nutrition.
 *
 * Every call is a closed function: the runtime role has no privilege on the tables. The
 * functions answer jsonb, so numbers arrive as numbers and dates as ISO strings; what
 * goes in travels as `::text::jsonb`, because `postgres.js` would otherwise serialise the
 * serialised text again (`T-EXE-IDEM-10`).
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  ConsentRow,
  MealRow,
  MealRowPage,
  NutritionDatabase,
  NutritionDailySummaryPage,
  NutritionFood,
  NutritionFoodPage,
  NutritionFrequentFoodPage,
  NutritionGoalDecision,
  NutritionGoals,
  NutritionGoalVersion,
} from '../domain/index.js'

export function createNutritionDatabase(): NutritionDatabase {
  const sql = database()

  return {
    recordMeal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ meal: MealRow | null }[]>`
          select nutrition.record_meal(
            ${input.personId}::uuid, ${JSON.stringify(input.meal)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as meal
        `
        return row?.meal ?? null
      }),

    readMeal: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ meal: MealRow | null }[]>`
          select nutrition.read_meal(${input.personId}::uuid, ${input.mealId}::uuid) as meal
        `
        return row?.meal ?? null
      }),

    listMeals: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ page: MealRowPage }[]>`
          select nutrition.list_my_meals(
            ${input.personId}::uuid, ${input.from}::date, ${input.to}::date,
            ${input.cursor}, ${input.limit}::integer
          ) as page
        `
        if (!row) throw new Error('PostgreSQL did not list the meals')
        return row.page
      }),

    reviseMeal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<
          { meal: MealRow & { disposed_media_ref: string | null } }[]
        >`
          select nutrition.revise_meal(
            ${input.personId}::uuid, ${input.mealId}::uuid, ${input.revision}::integer,
            ${JSON.stringify(input.patch)}::text::jsonb, ${JSON.stringify(input.media)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as meal
        `
        if (!row) throw new Error('PostgreSQL did not revise the meal')
        return row.meal
      }),

    deleteMeal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ outcome: { disposed_media_ref: string | null } }[]>`
          select nutrition.delete_meal(
            ${input.personId}::uuid, ${input.mealId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as outcome
        `
        if (!row) throw new Error('PostgreSQL did not delete the meal')
        return { disposed_media_ref: row.outcome.disposed_media_ref }
      }),

    sealDisposal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        await transaction`
          select nutrition.seal_media_disposal(${input.personId}::uuid, ${input.mediaRef})
        `
      }),

    readDailySummaries: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ days: NutritionDailySummaryPage }[]>`
          select nutrition.read_daily_summaries(
            ${input.personId}::uuid, ${input.from}::date, ${input.to}::date,
            ${input.timezone ?? 'UTC'}
          ) as days
        `
        if (!row) throw new Error('PostgreSQL did not read the days')
        return row.days
      }),

    readGoals: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ goals: NutritionGoals }[]>`
          select nutrition.read_my_goals(${input.personId}::uuid) as goals
        `
        if (!row) throw new Error('PostgreSQL did not read the goals')
        return row.goals
      }),

    publishGoal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ version: NutritionGoalVersion }[]>`
          select nutrition.publish_self_goal_version(
            ${input.personId}::uuid, ${input.goal.rationale ?? null},
            ${JSON.stringify(input.goal.targets)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as version
        `
        if (!row) throw new Error('PostgreSQL did not publish the goal')
        return row.version
      }),

    decideGoal: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ decision: NutritionGoalDecision }[]>`
          select nutrition.decide_goal_version(
            ${input.personId}::uuid, ${input.goalVersionId}::uuid, ${input.decision},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as decision
        `
        if (!row) throw new Error('PostgreSQL did not decide the goal')
        return row.decision
      }),

    searchFoods: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ page: NutritionFoodPage }[]>`
          select nutrition.search_foods(${input.query}, ${input.limit}::integer) as page
        `
        if (!row) throw new Error('PostgreSQL did not search the catalogue')
        return row.page
      }),

    frequentFoods: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ page: NutritionFrequentFoodPage }[]>`
          select nutrition.my_frequent_foods(${input.personId}::uuid, 10) as page
        `
        if (!row) throw new Error('PostgreSQL did not read the frequent foods')
        return row.page
      }),

    matchFoods: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ foods: (NutritionFood | null)[] }[]>`
          select nutrition.match_foods(${[...input.names]}::text[]) as foods
        `
        return row?.foods ?? []
      }),

    requireRecognition: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        await transaction`select nutrition.require_recognition(${input.personId}::uuid)`
      }),

    readConsent: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ consent: ConsentRow | null }[]>`
          select nutrition.read_recognition_consent(${input.personId}::uuid) as consent
        `
        return row?.consent ?? null
      }),

    acceptConsent: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [row] = await transaction<{ consent: ConsentRow }[]>`
          select nutrition.accept_recognition_consent(
            ${input.personId}::uuid, ${input.version},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as consent
        `
        if (!row) throw new Error('PostgreSQL did not record the consent')
        return row.consent
      }),
  }
}

function transact<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureStudioRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'person', true),
               set_config('app.actor_person_id', ${personId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
