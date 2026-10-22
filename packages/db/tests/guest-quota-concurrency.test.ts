import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

// HU-STUDIO-087: two people inviting into the last place of a gym must not both win.
// The actors are an owner and an unassigned coach, so the count is also read the way
// it is for the role the ordinary read policy narrows.

const OWNER_ID = '0199b300-0000-7000-8000-000000000001'
const COACH_ID = '0199b300-0000-7000-8000-000000000002'
const ORGANIZATION_ID = '0199b300-0000-7000-8000-000000000003'
const OWNER_MEMBERSHIP_ID = '0199b300-0000-7000-8000-000000000004'
const COACH_MEMBERSHIP_ID = '0199b300-0000-7000-8000-000000000005'
const SCOPE_ID = '0199b300-0000-7000-8000-000000000006'
const COMMAND_IDS = [
  '0199b300-0000-7000-8000-000000000011',
  '0199b300-0000-7000-8000-000000000012',
] as const
const IDEMPOTENCY_KEYS = [
  'c1111111-1111-4111-8111-111111111112',
  'c2222222-2222-4222-8222-222222222223',
] as const

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

async function cleanup() {
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`update organizations.organizations set status = 'closed' where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from system.outbox_events where aggregate_id in (select id from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid)`
    await transaction`delete from system.idempotency_keys where command_id in (${COMMAND_IDS[0]}::uuid, ${COMMAND_IDS[1]}::uuid)`
    await transaction`delete from privacy.invitation_scope_options where scope_definition_id = ${SCOPE_ID}::uuid`
    await transaction`delete from identity.invitation_intents where invitation_id in (select id from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid)`
    await transaction`delete from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from organizations.membership_roles where membership_id in (${OWNER_MEMBERSHIP_ID}::uuid, ${COACH_MEMBERSHIP_ID}::uuid)`
    await transaction`delete from organizations.organization_memberships where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    // Scope versions are append-only by trigger. This probe row is the only one that
    // test data ever adds, so the triggers are skipped for this one transaction.
    await transaction`set local session_replication_role = replica`
    await transaction`delete from privacy.scope_definitions where id = ${SCOPE_ID}::uuid`
    await transaction`delete from identity.people where id in (${OWNER_ID}::uuid, ${COACH_ID}::uuid)`
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`insert into identity.people (id, given_name, family_name) values (${OWNER_ID}::uuid, 'Quota', 'Owner'), (${COACH_ID}::uuid, 'Quota', 'Coach')`
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
      values (
        ${ORGANIZATION_ID}::uuid,
        'gym',
        'Concurrent quota gym',
        '{"party_kind":"legal_entity","party_name":"Quota SAS","purpose":"studio_operations"}'::jsonb,
        'closed'
      )
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values (${OWNER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${OWNER_ID}::uuid),
             (${COACH_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${COACH_ID}::uuid)
    `
    await transaction`
      insert into organizations.membership_roles (membership_id, role_code)
      values (${OWNER_MEMBERSHIP_ID}::uuid, 'owner'), (${COACH_MEMBERSHIP_ID}::uuid, 'coach')
    `
    await transaction`
      insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
      values (${SCOPE_ID}::uuid, 'body_progress', 9001, 'published', clock_timestamp())
    `
    await transaction`update organizations.organizations set status = 'active', guest_quota_seats = 1 where id = ${ORGANIZATION_ID}::uuid`
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

// Sets the actor context the API sets, including the organization: without it the
// coach reads no relationship at all and the test would prove nothing about counting.
function invite(
  client: ReturnType<typeof postgres>,
  actorId: string,
  index: 0 | 1,
  contact: string,
) {
  const suffix = index === 0 ? 'e1' : 'e2'
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${actorId}, true)`
    await transaction`select set_config('app.actor_org_id', ${ORGANIZATION_ID}, true)`
    return transaction`
      select * from identity.issue_client_invitation(
        ${actorId}::uuid,
        ${ORGANIZATION_ID}::uuid,
        'email',
        ${contact},
        '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento","presented_snapshot":{"title":"Progreso"}}]'::jsonb,
        decode(repeat(${suffix}, 32), 'hex'),
        1::smallint,
        ${IDEMPOTENCY_KEYS[index]}::uuid,
        ${COMMAND_IDS[index]}::uuid,
        decode(repeat(${suffix}, 32), 'hex')
      )
    `
  })
}

test('two inviters racing for the last place leave exactly one invitation', async () => {
  const outcomes = await Promise.allSettled([
    invite(first, OWNER_ID, 0, 'one@example.test'),
    invite(second, COACH_ID, 1, 'two@example.test'),
  ])

  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  const rejected = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  )
  expect(rejected).toHaveLength(1)
  expect(rejected[0]?.reason).toMatchObject({
    code: '55000',
    message: 'the gym has no places left in its guest quota',
  })

  const [counts] = await admin`
    select count(*)::integer as invitations
    from identity.invitations
    where organization_id = ${ORGANIZATION_ID}::uuid
  `
  expect(counts?.invitations).toBe(1)
})
