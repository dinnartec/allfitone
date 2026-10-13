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
] as const

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
} finally {
  await sql.end({ timeout: 1 })
}
