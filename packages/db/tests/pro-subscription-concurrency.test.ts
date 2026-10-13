/**
 * ADR-043 scenario 10, under a real race: a person has one live Pro subscription, and a
 * store subscription belongs to one person.
 *
 * Both rules could be kept by reading before writing, and both would break when two
 * purchases arrive together. The first is held by an advisory lock per person plus a
 * partial unique index; the second by a partial unique index on the store reference. These
 * tests are what distinguish that from the look-before-you-write version.
 *
 * Subscriptions, versions and duties are history and refuse deletion, so each run uses
 * fresh identifiers and the cleanup lifts those guards as their owner, only to remove its
 * own rows.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

const run = randomUUID().slice(0, 8)
const BUYER_ID = randomUUID()
const OTHER_ID = randomUUID()
const PROPOSER_ID = randomUUID()
const GRANTOR_ID = randomUUID()
const DUTY_ID = randomUUID()
const PLAN_ID = randomUUID()
const VERSION_ID = randomUUID()
const PRODUCT_ID = `allfit.race.${run}`
const PEOPLE = [BUYER_ID, OTHER_ID, PROPOSER_ID, GRANTOR_ID]

const connectionOptions = {
  host: process.env.SUPABASE_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SUPABASE_DB_PORT ?? 54322),
  database: process.env.SUPABASE_DB_NAME ?? 'postgres',
  username: process.env.SUPABASE_DB_USER ?? 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD ?? 'postgres',
  prepare: false,
  max: 1,
} as const

const admin = postgres(connectionOptions)
const first = postgres(connectionOptions)
const second = postgres(connectionOptions)

const GUARDED = [
  'payments.platform_payment_records',
  'payments.platform_subscription_events',
  'payments.platform_subscriptions',
  'payments.platform_store_products',
  'payments.platform_plan_versions',
  'payments.platform_plans',
  'support.platform_duty_assignments',
] as const

async function cleanup() {
  await admin.begin(async (transaction) => {
    await transaction`set local role allfit_owner`
    for (const table of GUARDED)
      await transaction.unsafe(`alter table ${table} disable trigger user`)
    await transaction`delete from payments.platform_payment_records where person_id in ${admin(PEOPLE)}`
    await transaction`
      delete from payments.platform_subscription_events
      where platform_subscription_id in (
        select id from payments.platform_subscriptions where person_id in ${admin(PEOPLE)}
      )`
    await transaction`
      delete from system.outbox_events
      where aggregate_id in (
        select id from payments.platform_subscriptions where person_id in ${admin(PEOPLE)}
      )`
    await transaction`delete from payments.platform_subscriptions where person_id in ${admin(PEOPLE)}`
    await transaction`delete from payments.platform_store_products where product_id = ${PRODUCT_ID}`
    await transaction`delete from payments.platform_plan_versions where id = ${VERSION_ID}::uuid`
    await transaction`delete from payments.platform_plans where id = ${PLAN_ID}::uuid`
    await transaction`delete from support.platform_duty_assignments where id = ${DUTY_ID}::uuid`
    for (const table of GUARDED)
      await transaction.unsafe(`alter table ${table} enable trigger user`)
    await transaction`
      delete from system.idempotency_keys
      where principal_fingerprint in (
        select extensions.digest(convert_to(person::text, 'UTF8'), 'sha256')
        from unnest(${PEOPLE}::uuid[]) as person
      )`
    await transaction`delete from identity.people where id in ${admin(PEOPLE)}`
  })
}

beforeAll(async () => {
  await admin.begin(async (transaction) => {
    await transaction`set local role allfit_owner`
    await transaction`
      insert into identity.people (id, given_name, family_name, status)
      values
        (${BUYER_ID}::uuid, 'Race', 'Buyer', 'active'),
        (${OTHER_ID}::uuid, 'Race', 'Other', 'active'),
        (${PROPOSER_ID}::uuid, 'Race', 'Proposer', 'active'),
        (${GRANTOR_ID}::uuid, 'Race', 'Grantor', 'active')
    `
    // Only the catalogue's author is needed here, not a grantable duty: its guard stays off.
    await transaction`alter table support.platform_duty_assignments disable trigger user`
    await transaction`
      insert into support.platform_duty_assignments (
        id, person_id, duty_code, actor_mode, status, valid_from, valid_to,
        granted_by_person_id, reason_code
      ) values (
        ${DUTY_ID}::uuid, ${PROPOSER_ID}::uuid, 'manage_platform_commercial', 'A11', 'active',
        clock_timestamp(), clock_timestamp() + interval '30 days', ${GRANTOR_ID}::uuid, 'RACE'
      )
    `
    await transaction`alter table support.platform_duty_assignments enable trigger user`
    await transaction`
      insert into payments.platform_plans (
        id, code, name, plan_kind, created_by_person_id, created_by_duty_assignment_id
      ) values (
        ${PLAN_ID}::uuid, ${`race_${run}`}, 'Race', 'paid', ${PROPOSER_ID}::uuid, ${DUTY_ID}::uuid
      )
    `
    await transaction`
      insert into payments.platform_plan_versions (
        id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
        billing_period, proposed_by_person_id, proposed_by_duty_assignment_id
      ) values (
        ${VERSION_ID}::uuid, ${PLAN_ID}::uuid, 'paid', 1, 19900, 'COP', 'month',
        ${PROPOSER_ID}::uuid, ${DUTY_ID}::uuid
      )
    `
    await transaction`
      insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
      values ('app_store', ${PRODUCT_ID}, ${VERSION_ID}::uuid)
    `
  })
})

afterAll(async () => {
  await cleanup()
  await Promise.all([
    admin.end({ timeout: 1 }),
    first.end({ timeout: 1 }),
    second.end({ timeout: 1 }),
  ])
})

function purchase(client: ReturnType<typeof postgres>, person: string, ref: string) {
  const bought = {
    store: 'app_store',
    environment: 'sandbox',
    product_id: PRODUCT_ID,
    subscription_ref: ref,
    transaction_id: ref,
    account_token: person,
    status: 'active',
    auto_renews: true,
    current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    observed_at: new Date().toISOString(),
  }
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${person}, true)`
    return transaction`
      select * from payments.record_store_subscription(
        ${person}::uuid,
        ${JSON.stringify(bought)}::text::jsonb,
        ${randomUUID()}::uuid,
        ${randomUUID()}::uuid,
        extensions.gen_random_bytes(32)
      )
    `
  })
}

test('two purchases of one person racing leave one live subscription', async () => {
  const outcomes = await Promise.allSettled([
    purchase(first, BUYER_ID, `${run}-a`),
    purchase(second, BUYER_ID, `${run}-b`),
  ])

  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(2)

  const [state] = await admin`
    select
      count(*) filter (where status <> 'ended')::integer as live,
      count(*) filter (where ended_reason = 'replaced')::integer as replaced
    from payments.platform_subscriptions
    where person_id = ${BUYER_ID}::uuid
  `
  expect(state?.live).toBe(1)
  expect(state?.replaced).toBe(1)
})

test('two people racing for one store subscription: one owns it, the other is refused', async () => {
  const shared = `${run}-shared`
  const outcomes = await Promise.allSettled([
    purchase(first, OTHER_ID, shared),
    purchase(second, PROPOSER_ID, shared),
  ])

  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  const refused = outcomes.find((outcome) => outcome.status === 'rejected')
  expect((refused as PromiseRejectedResult | undefined)?.reason?.code).toBe('23505')

  const [state] = await admin`
    select count(distinct person_id)::integer as owners
    from payments.platform_subscriptions
    where store_subscription_ref = ${shared}
  `
  expect(state?.owners).toBe(1)
})
