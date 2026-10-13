/**
 * Local-only: publishes the free plan and Pro, and the store products that sell Pro, so
 * Space has something to show and buy on a developer's machine (ADR-043).
 *
 * In every real environment a plan is published through Backoffice by two people with the
 * commercial duty, one proposing and another publishing. A fresh local database has
 * neither, and the ceremony that would create them belongs to a person, not to a script.
 * So this script writes the catalogue as its owner, with the guards that enforce the
 * ceremony lifted for the length of one transaction, under two local people who exist
 * only to author it. It never runs against a database that is not on this machine, and it
 * leaves an existing `pro` plan alone.
 *
 *   bun packages/db/scripts/publish-local-pro.ts
 *
 * The product ids match the StoreKit configuration file of the Space app.
 *
 * It also adds a handful of **invented** functions, so the screens have limits to show
 * while product decides the real catalogue. They exist only on this machine: in every
 * real environment a function enters the catalogue by migration, with the code that
 * enforces it.
 */

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const LOCAL_PRO_PRODUCT = 'com.dinnartec.allfitspace.pro.monthly'

const url = process.env.DATABASE_URL ?? DEFAULT_URL
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error('publish-local-pro only runs against a local database')
}

const GUARDED = [
  'support.platform_duty_assignments',
  'payments.platform_plans',
  'payments.platform_plan_versions',
  'payments.platform_plan_features',
] as const

// Code and name; then each plan's limit (null is unlimited), or false when it is left out.
const DEMO_FEATURES: readonly [string, string, number | null | false, number | null | false][] = [
  ['active_programs', 'Programas activos', 1, null],
  ['own_routines', 'Rutinas propias', 4, null],
  ['history_months', 'Historial', 3, null],
  ['meal_photos', 'Comidas por foto', false, null],
]
// Demo functions this script used to add, removed so a local catalogue matches the list above.
const RETIRED = ['meal_photos_per_day', 'compared_history_weeks']

async function demoFeatures(): Promise<string> {
  return sql.begin(async (transaction) => {
    await transaction`set local role allfit_owner`
    await transaction`alter table payments.platform_plan_features disable trigger user`
    await transaction`delete from payments.platform_plan_features where feature_code in ${sql(RETIRED)}`
    await transaction`delete from payments.platform_features where code in ${sql(RETIRED)}`
    for (const [code, name, free, pro] of DEMO_FEATURES) {
      await transaction`
        insert into payments.platform_features (code, name, unit) values (${code}, ${name}, null)
        on conflict (code) do nothing
      `
      for (const [kind, limit] of [
        ['free', free],
        ['paid', pro],
      ] as const) {
        await transaction`
          insert into payments.platform_plan_features (platform_plan_version_id, feature_code, limit_value, enabled)
          select version.id, ${code}, ${limit === false ? null : limit}::integer, ${limit !== false}
          from payments.platform_plan_versions as version
          join payments.platform_plans as plan on plan.id = version.platform_plan_id
          where version.status = 'published' and plan.plan_kind = ${kind}
          on conflict (platform_plan_version_id, feature_code)
          do update set limit_value = excluded.limit_value, enabled = excluded.enabled
        `
      }
    }
    await transaction`alter table payments.platform_plan_features enable trigger user`
    return `Demo functions in place: ${DEMO_FEATURES.map(([code]) => code).join(', ')}.`
  })
}

const sql = postgres(url, { prepare: false, max: 1 })

async function publish(): Promise<string> {
  const proposer = randomUUID()
  const publisher = randomUUID()
  const proposerDuty = randomUUID()
  const publisherDuty = randomUUID()

  return sql.begin(async (transaction) => {
    await transaction`set local role allfit_owner`
    const [existing] = await transaction`select 1 from payments.platform_plans where code = 'pro'`
    if (existing) return 'Pro is already published; nothing changed.'

    for (const table of GUARDED)
      await transaction.unsafe(`alter table ${table} disable trigger user`)

    await transaction`
      insert into identity.people (id, given_name, family_name, status)
      values (${proposer}::uuid, 'Catálogo', 'Local', 'active'),
             (${publisher}::uuid, 'Revisión', 'Local', 'active')
    `
    await transaction`
      insert into support.platform_duty_assignments (
        id, person_id, duty_code, actor_mode, status, valid_from, valid_to,
        granted_by_person_id, reason_code
      ) values
        (${proposerDuty}::uuid, ${proposer}::uuid, 'manage_platform_commercial', 'A11', 'expired',
          clock_timestamp() - interval '1 day', clock_timestamp(), ${publisher}::uuid, 'LOCAL-PRO'),
        (${publisherDuty}::uuid, ${publisher}::uuid, 'manage_platform_commercial', 'A11', 'expired',
          clock_timestamp() - interval '1 day', clock_timestamp(), ${proposer}::uuid, 'LOCAL-PRO')
    `

    for (const plan of [
      { code: 'free', name: 'Gratis', kind: 'free', amount: 0, currency: null, period: null },
      {
        code: 'pro',
        name: 'Pro',
        kind: 'paid',
        amount: 1_990_000,
        currency: 'COP',
        period: 'month',
      },
    ]) {
      const planId = randomUUID()
      const versionId = randomUUID()
      await transaction`
        insert into payments.platform_plans (
          id, code, name, plan_kind, status, created_by_person_id, created_by_duty_assignment_id
        ) values (
          ${planId}::uuid, ${plan.code}, ${plan.name}, ${plan.kind}, 'published',
          ${proposer}::uuid, ${proposerDuty}::uuid
        )
        on conflict (code) do nothing
      `
      await transaction`
        insert into payments.platform_plan_versions (
          id, platform_plan_id, plan_kind, version_number, amount_minor, currency_code,
          billing_period, status, proposed_by_person_id, proposed_by_duty_assignment_id,
          published_by_person_id, published_by_duty_assignment_id, published_at
        )
        select ${versionId}::uuid, existing.id, ${plan.kind}, 1, ${plan.amount}, ${plan.currency},
               ${plan.period}, 'published', ${proposer}::uuid, ${proposerDuty}::uuid,
               ${publisher}::uuid, ${publisherDuty}::uuid, clock_timestamp()
        from payments.platform_plans as existing
        where existing.code = ${plan.code}
          and not exists (
            select 1 from payments.platform_plan_versions as version
            where version.platform_plan_id = existing.id and version.status = 'published'
          )
      `
      // Every version declares every function the catalogue holds, disabled where unknown.
      await transaction`
        insert into payments.platform_plan_features (platform_plan_version_id, feature_code, limit_value, enabled)
        select ${versionId}::uuid, feature.code, null, true
        from payments.platform_features as feature
        where exists (select 1 from payments.platform_plan_versions where id = ${versionId}::uuid)
      `
      if (plan.kind === 'paid') {
        await transaction`
          insert into payments.platform_store_products (store, product_id, platform_plan_version_id)
          select store, ${LOCAL_PRO_PRODUCT}, ${versionId}::uuid
          from unnest(array['app_store', 'google_play']::payments.platform_store[]) as store
          where exists (select 1 from payments.platform_plan_versions where id = ${versionId}::uuid)
        `
      }
    }

    for (const table of GUARDED)
      await transaction.unsafe(`alter table ${table} enable trigger user`)
    return `Published the free plan and Pro, sold as ${LOCAL_PRO_PRODUCT} in both stores.`
  })
}

try {
  console.log(await publish())
  console.log(await demoFeatures())
} finally {
  await sql.end({ timeout: 1 })
}
