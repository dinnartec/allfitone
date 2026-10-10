/**
 * Criterion 9 of `HU-STUDIO-029`, under a real race.
 *
 * "Reintentar la propuesta no crea otra suplencia pendiente equivalente" cannot
 * be kept by reading the table and then writing to it: two commands arriving
 * together both read no proposal and both write one. So the rule is a partial
 * unique index, and this is the test that distinguishes the two
 * implementations — the look-before-you-write version passes every test except
 * this one.
 *
 * Two connections, two different idempotency keys, two different commands, the
 * same intent. One wins, the other is refused with `23505`, and the person is
 * asked exactly once.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

const CLIENT_ID = '019d2000-0000-7000-8000-000000000001'
const OWNER_ID = '019d2000-0000-7000-8000-000000000002'
const HOLDER_ID = '019d2000-0000-7000-8000-000000000003'
const COVER_ID = '019d2000-0000-7000-8000-000000000004'
const ORGANIZATION_ID = '019d2000-0000-7000-8000-000000000011'
const OWNER_MEMBERSHIP_ID = '019d2000-0000-7000-8000-000000000021'
const HOLDER_MEMBERSHIP_ID = '019d2000-0000-7000-8000-000000000022'
const COVER_MEMBERSHIP_ID = '019d2000-0000-7000-8000-000000000023'
const RELATIONSHIP_ID = '019d2000-0000-7000-8000-000000000031'
const HOLDER_ASSIGNMENT_ID = '019d2000-0000-7000-8000-000000000041'
const FIRST_COMMAND_ID = '019d2000-0000-7000-8000-000000000051'
const SECOND_COMMAND_ID = '019d2000-0000-7000-8000-000000000052'
const THIRD_COMMAND_ID = '019d2000-0000-7000-8000-000000000053'
const FOURTH_COMMAND_ID = '019d2000-0000-7000-8000-000000000054'
const FIRST_IDEMPOTENCY_KEY = 'd1111111-1111-4111-8111-111111111111'
const SECOND_IDEMPOTENCY_KEY = 'd2222222-2222-4222-8222-222222222222'
const THIRD_IDEMPOTENCY_KEY = 'd3333333-3333-4333-8333-333333333333'
const FOURTH_IDEMPOTENCY_KEY = 'd4444444-4444-4444-8444-444444444444'

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

const COMMANDS = [FIRST_COMMAND_ID, SECOND_COMMAND_ID, THIRD_COMMAND_ID, FOURTH_COMMAND_ID] as const

async function cleanup() {
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`delete from system.outbox_events where aggregate_id = ${RELATIONSHIP_ID}::uuid`
    await transaction`delete from system.idempotency_keys where command_id in ${admin(COMMANDS)}`
    await transaction`delete from relationships.relationship_professional_assignments where relationship_id = ${RELATIONSHIP_ID}::uuid`
    await transaction`delete from relationships.service_relationships where id = ${RELATIONSHIP_ID}::uuid`
    await transaction`delete from organizations.membership_roles where membership_id in (${OWNER_MEMBERSHIP_ID}::uuid, ${HOLDER_MEMBERSHIP_ID}::uuid, ${COVER_MEMBERSHIP_ID}::uuid)`
    await transaction`delete from organizations.organization_memberships where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id in (${CLIENT_ID}::uuid, ${OWNER_ID}::uuid, ${HOLDER_ID}::uuid, ${COVER_ID}::uuid)`
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`
      insert into identity.people (id, given_name, family_name, contact_email)
      values
        (${CLIENT_ID}::uuid, 'Concurrent', 'Client', 'concurrent-client@example.test'),
        (${OWNER_ID}::uuid, 'Concurrent', 'Owner', null),
        (${HOLDER_ID}::uuid, 'Concurrent', 'Holder', null),
        (${COVER_ID}::uuid, 'Concurrent', 'Cover', null)
    `
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party)
      values (
        ${ORGANIZATION_ID}::uuid,
        'studio',
        'Concurrent substitution studio',
        '{"party_kind":"natural_person","party_name":"Concurrent Owner","purpose":"studio_operations"}'::jsonb
      )
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values
        (${OWNER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${OWNER_ID}::uuid),
        (${HOLDER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${HOLDER_ID}::uuid),
        (${COVER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${COVER_ID}::uuid)
    `
    await transaction`
      insert into organizations.membership_roles (membership_id, role_code)
      values
        (${OWNER_MEMBERSHIP_ID}::uuid, 'owner'),
        (${HOLDER_MEMBERSHIP_ID}::uuid, 'coach'),
        (${COVER_MEMBERSHIP_ID}::uuid, 'coach')
    `
    await transaction`
      insert into relationships.service_relationships (id, person_id, organization_id, status)
      values (${RELATIONSHIP_ID}::uuid, ${CLIENT_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'active')
    `
    await transaction`
      insert into relationships.relationship_professional_assignments (
        id, relationship_id, person_id, organization_id, membership_id, kind, status
      ) values (
        ${HOLDER_ASSIGNMENT_ID}::uuid, ${RELATIONSHIP_ID}::uuid, ${CLIENT_ID}::uuid,
        ${ORGANIZATION_ID}::uuid, ${HOLDER_MEMBERSHIP_ID}::uuid, 'holder', 'active'
      )
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

function propose(
  client: ReturnType<typeof postgres>,
  commandId: string,
  idempotencyKey: string,
  suffix: string,
  days: { from: number; to: number } = { from: 3, to: 10 },
) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${OWNER_ID}, true)`
    await transaction`select set_config('app.request_id', gen_random_uuid()::text, true)`
    return transaction`
      select * from relationships.propose_substitution(
        ${OWNER_ID}::uuid,
        ${ORGANIZATION_ID}::uuid,
        ${RELATIONSHIP_ID}::uuid,
        ${COVER_MEMBERSHIP_ID}::uuid,
        (current_date + ${days.from}::integer)::date,
        (current_date + ${days.to}::integer)::date,
        ${idempotencyKey}::uuid,
        ${commandId}::uuid,
        decode(repeat(${suffix}, 32), 'hex')
      )
    `
  })
}

test('two equivalent proposals racing leave one cover and ask the person once', async () => {
  const outcomes = await Promise.allSettled([
    propose(first, FIRST_COMMAND_ID, FIRST_IDEMPOTENCY_KEY, 'd1'),
    propose(second, SECOND_COMMAND_ID, SECOND_IDEMPOTENCY_KEY, 'd2'),
  ])

  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  const refused = outcomes.find((outcome) => outcome.status === 'rejected')
  // `23505` and not a serialization failure: the index refuses it outright, so
  // the caller gets a conflict rather than something a retry might fix.
  expect((refused as PromiseRejectedResult | undefined)?.reason?.code).toBe('23505')

  const [state] = await admin`
    select
      (select count(*)::integer
       from relationships.relationship_professional_assignments
       where relationship_id = ${RELATIONSHIP_ID}::uuid and kind = 'substitute') as covers,
      (select count(*)::integer
       from system.outbox_events
       where aggregate_id = ${RELATIONSHIP_ID}::uuid
         and event_type = 'relationship.substitution_proposed.v1') as asked
  `
  expect(state?.covers).toBe(1)
  expect(state?.asked).toBe(1)
})

/*
 * The index has to be narrow enough to still be useful. Two covers for the same
 * professional over windows that do not coincide are two different questions,
 * and an index that collapsed them would make a holiday in November impossible
 * because one was already proposed for October.
 */
test('two proposals for different windows both stand', async () => {
  const outcomes = await Promise.allSettled([
    propose(first, THIRD_COMMAND_ID, THIRD_IDEMPOTENCY_KEY, 'd3', { from: 20, to: 25 }),
    propose(second, FOURTH_COMMAND_ID, FOURTH_IDEMPOTENCY_KEY, 'd4', { from: 40, to: 45 }),
  ])

  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(2)

  const [state] = await admin`
    select count(*)::integer as covers
    from relationships.relationship_professional_assignments
    where relationship_id = ${RELATIONSHIP_ID}::uuid and kind = 'substitute'
  `
  expect(state?.covers).toBe(3)
})
