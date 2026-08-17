import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

const OWNER_PERSON_ID = '019a2000-0000-7000-8000-000000000001'
const FIRST_TARGET_PERSON_ID = '019a2000-0000-7000-8000-000000000002'
const SECOND_TARGET_PERSON_ID = '019a2000-0000-7000-8000-000000000003'
const ORGANIZATION_ID = '019a2000-0000-7000-8000-000000000101'
const OWNER_MEMBERSHIP_ID = '019a2000-0000-7000-8000-000000000201'
const FIRST_TARGET_MEMBERSHIP_ID = '019a2000-0000-7000-8000-000000000202'
const SECOND_TARGET_MEMBERSHIP_ID = '019a2000-0000-7000-8000-000000000203'
const FIRST_COMMAND_ID = '019a2000-0000-7000-8000-000000000301'
const SECOND_COMMAND_ID = '019a2000-0000-7000-8000-000000000302'
const LOCK_PERSON_ID = '019a2000-0000-7000-8000-000000000004'
const LOCK_ORGANIZATION_ID = '019a2000-0000-7000-8000-000000000104'
const LOCK_MEMBERSHIP_ID = '019a2000-0000-7000-8000-000000000204'
const LOCK_COMMAND_ID = '019a2000-0000-7000-8000-000000000304'

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
const holder = postgres(connectionOptions)

async function cleanup(): Promise<void> {
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`
      update organizations.organizations
      set status = 'closed'
      where id = ${ORGANIZATION_ID}::uuid
    `
    await transaction`
      delete from organizations.organization_events
      where organization_id in (${ORGANIZATION_ID}::uuid, ${LOCK_ORGANIZATION_ID}::uuid)
    `
    await transaction`
      delete from organizations.membership_events
      where membership_id in (
        ${OWNER_MEMBERSHIP_ID}::uuid,
        ${FIRST_TARGET_MEMBERSHIP_ID}::uuid,
        ${SECOND_TARGET_MEMBERSHIP_ID}::uuid
        , ${LOCK_MEMBERSHIP_ID}::uuid
      )
    `
    await transaction`
      delete from organizations.membership_roles
      where membership_id in (
        ${OWNER_MEMBERSHIP_ID}::uuid,
        ${FIRST_TARGET_MEMBERSHIP_ID}::uuid,
        ${SECOND_TARGET_MEMBERSHIP_ID}::uuid
        , ${LOCK_MEMBERSHIP_ID}::uuid
      )
    `
    await transaction`
      delete from organizations.organization_memberships
      where organization_id in (${ORGANIZATION_ID}::uuid, ${LOCK_ORGANIZATION_ID}::uuid)
    `
    await transaction`
      delete from organizations.organizations
      where id in (${ORGANIZATION_ID}::uuid, ${LOCK_ORGANIZATION_ID}::uuid)
    `
    await transaction`
      delete from system.idempotency_keys
      where command_id in (
        ${FIRST_COMMAND_ID}::uuid,
        ${SECOND_COMMAND_ID}::uuid,
        ${LOCK_COMMAND_ID}::uuid
      )
    `
    await transaction`
      delete from identity.people
      where id in (
        ${OWNER_PERSON_ID}::uuid,
        ${FIRST_TARGET_PERSON_ID}::uuid,
        ${SECOND_TARGET_PERSON_ID}::uuid
        , ${LOCK_PERSON_ID}::uuid
      )
    `
  })
}

async function transferOwnership(
  client: ReturnType<typeof postgres>,
  targetMembershipId: string,
  idempotencyKey: string,
  commandId: string,
  hashByte: string,
) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${OWNER_PERSON_ID}, true)`
    return transaction`
      select organizations.transfer_ownership(
        ${OWNER_PERSON_ID}::uuid,
        ${ORGANIZATION_ID}::uuid,
        ${targetMembershipId}::uuid,
        ${idempotencyKey}::uuid,
        ${commandId}::uuid,
        decode(repeat(${hashByte}, 32), 'hex')
      )
    `
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`
      insert into identity.people (id, given_name, family_name)
      values
        (${OWNER_PERSON_ID}::uuid, 'Concurrent', 'Owner'),
        (${FIRST_TARGET_PERSON_ID}::uuid, 'First', 'Target'),
        (${SECOND_TARGET_PERSON_ID}::uuid, 'Second', 'Target')
        , (${LOCK_PERSON_ID}::uuid, 'Lock', 'Owner')
    `
    await transaction`
      insert into organizations.organizations (
        id, type_code, display_name, responsible_party, status
      ) values (
        ${ORGANIZATION_ID}::uuid,
        'studio',
        'Concurrent ownership studio',
        '{"party_kind":"legal_entity","party_name":"Concurrent ownership studio","purpose":"studio_operations"}'::jsonb,
        'closed'
      ), (
        ${LOCK_ORGANIZATION_ID}::uuid,
        'studio',
        'Lock timeout studio',
        '{"party_kind":"legal_entity","party_name":"Lock timeout studio","purpose":"studio_operations"}'::jsonb,
        'closed'
      )
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values
        (${OWNER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${OWNER_PERSON_ID}::uuid),
        (${FIRST_TARGET_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${FIRST_TARGET_PERSON_ID}::uuid),
        (${SECOND_TARGET_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${SECOND_TARGET_PERSON_ID}::uuid)
        , (${LOCK_MEMBERSHIP_ID}::uuid, ${LOCK_ORGANIZATION_ID}::uuid, ${LOCK_PERSON_ID}::uuid)
    `
    await transaction`
      insert into organizations.membership_roles (membership_id, role_code)
      values (${OWNER_MEMBERSHIP_ID}::uuid, 'owner')
        , (${LOCK_MEMBERSHIP_ID}::uuid, 'owner')
    `
    await transaction`
      update organizations.organizations
      set status = 'active'
      where id in (${ORGANIZATION_ID}::uuid, ${LOCK_ORGANIZATION_ID}::uuid)
    `
  })
})

afterAll(async () => {
  await cleanup()
  await Promise.all([
    admin.end({ timeout: 1 }),
    first.end({ timeout: 1 }),
    second.end({ timeout: 1 }),
    holder.end({ timeout: 1 }),
  ])
})

test('concurrent ownership transfers serialize and preserve exactly one owner', async () => {
  const outcomes = await Promise.allSettled([
    transferOwnership(
      first,
      FIRST_TARGET_MEMBERSHIP_ID,
      'b1111111-1111-4111-8111-111111111111',
      FIRST_COMMAND_ID,
      'b1',
    ),
    transferOwnership(
      second,
      SECOND_TARGET_MEMBERSHIP_ID,
      'b2222222-2222-4222-8222-222222222222',
      SECOND_COMMAND_ID,
      'b2',
    ),
  ])

  expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)

  const [state] = await admin`
    select
      count(*) filter (
        where role.role_code = 'owner' and role.valid_to is null
      )::integer as active_owners,
      (
        select count(*)::integer
        from organizations.organization_events as event
        where event.organization_id = ${ORGANIZATION_ID}::uuid
          and event.event_type = 'organization.ownership_transferred.v1'
      ) as transfer_events
    from organizations.organization_memberships as membership
    join organizations.membership_roles as role
      on role.membership_id = membership.id
    where membership.organization_id = ${ORGANIZATION_ID}::uuid
      and membership.status = 'active'
  `

  expect(state).toMatchObject({ active_owners: 1, transfer_events: 1 })
})

test('organization commands bound aggregate lock waits without duplicate effects', async () => {
  let releaseLock: (() => void) | undefined
  const lockHeld = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const holding = holder.begin(async (transaction) => {
    await transaction`
      select 1
      from organizations.organizations
      where id = ${LOCK_ORGANIZATION_ID}::uuid
      for update
    `
    await lockHeld
  })

  await new Promise((resolve) => setTimeout(resolve, 50))
  const startedAt = performance.now()
  let failure: unknown
  try {
    await first.begin(async (transaction) => {
      await transaction`set local role allfit_api`
      await transaction`select set_config('app.actor_kind', 'person', true)`
      await transaction`select set_config('app.actor_person_id', ${LOCK_PERSON_ID}, true)`
      await transaction`
        select organizations.create_site(
          ${LOCK_PERSON_ID}::uuid,
          ${LOCK_ORGANIZATION_ID}::uuid,
          '{"name":"Must not duplicate"}'::jsonb,
          'b3333333-3333-4333-8333-333333333333'::uuid,
          ${LOCK_COMMAND_ID}::uuid,
          decode(repeat('b3', 32), 'hex')
        )
      `
    })
  } catch (error) {
    failure = error
  } finally {
    releaseLock?.()
    await holding
  }

  expect(performance.now() - startedAt).toBeLessThan(1_500)
  expect(failure).toMatchObject({ code: '55P03' })
  const [effects] = await admin`
    select
      (select count(*)::integer from organizations.organization_sites
       where organization_id = ${LOCK_ORGANIZATION_ID}::uuid) as sites,
      (select count(*)::integer from organizations.organization_events
       where organization_id = ${LOCK_ORGANIZATION_ID}::uuid
         and event_type = 'organization.site_created.v1') as events,
      (select count(*)::integer from system.idempotency_keys
       where command_id = ${LOCK_COMMAND_ID}::uuid) as receipts
  `
  expect(effects).toEqual({ sites: 0, events: 0, receipts: 0 })
})
