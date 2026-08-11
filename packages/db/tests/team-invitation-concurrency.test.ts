import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

const PERSON_ID = '0199b200-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '0199b200-0000-7000-8000-000000000002'
const MEMBERSHIP_ID = '0199b200-0000-7000-8000-000000000003'
const FIRST_COMMAND_ID = '0199b200-0000-7000-8000-000000000011'
const SECOND_COMMAND_ID = '0199b200-0000-7000-8000-000000000012'
const FIRST_IDEMPOTENCY_KEY = 'c1111111-1111-4111-8111-111111111111'
const SECOND_IDEMPOTENCY_KEY = 'c2222222-2222-4222-8222-222222222222'

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
    await transaction`delete from system.outbox_events where aggregate_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid)`
    await transaction`delete from system.idempotency_keys where command_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid)`
    await transaction`delete from identity.invitation_intents where invitation_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid)`
    await transaction`delete from identity.invitations where id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid)`
    await transaction`delete from organizations.membership_roles where membership_id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_memberships where id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id = ${PERSON_ID}::uuid`
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`insert into identity.people (id, given_name, family_name) values (${PERSON_ID}::uuid, 'Concurrent', 'Inviter')`
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
      values (
        ${ORGANIZATION_ID}::uuid,
        'studio',
        'Concurrent invitation studio',
        '{"party_kind":"natural_person","party_name":"Concurrent Inviter","purpose":"studio_operations"}'::jsonb,
        'closed'
      )
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values (${MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${PERSON_ID}::uuid)
    `
    await transaction`insert into organizations.membership_roles (membership_id, role_code) values (${MEMBERSHIP_ID}::uuid, 'owner')`
    await transaction`update organizations.organizations set status = 'active' where id = ${ORGANIZATION_ID}::uuid`
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

function issue(
  client: ReturnType<typeof postgres>,
  commandId: string,
  idempotencyKey: string,
  suffix: string,
) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${PERSON_ID}, true)`
    return transaction`
      select * from identity.issue_staff_invitation(
        ${PERSON_ID}::uuid,
        ${ORGANIZATION_ID}::uuid,
        'email',
        'same@example.test',
        'staff',
        decode(repeat(${suffix}, 32), 'hex'),
        1::smallint,
        ${idempotencyKey}::uuid,
        ${commandId}::uuid,
        decode(repeat(${suffix}, 32), 'hex')
      )
    `
  })
}

test('concurrent equivalent proposals converge to one invitation and two delivery attempts', async () => {
  const [left, right] = await Promise.all([
    issue(first, FIRST_COMMAND_ID, FIRST_IDEMPOTENCY_KEY, 'c1'),
    issue(second, SECOND_COMMAND_ID, SECOND_IDEMPOTENCY_KEY, 'c2'),
  ])
  expect(left[0]?.invitation_id).toBe(right[0]?.invitation_id)
  const [counts] = await admin`
    select
      count(distinct invitation.id)::integer as invitations,
      count(distinct event.id)::integer as delivery_events
    from identity.invitations as invitation
    left join system.outbox_events as event on event.aggregate_id = invitation.id
    where invitation.organization_id = ${ORGANIZATION_ID}::uuid
  `
  expect(counts).toMatchObject({ invitations: 1, delivery_events: 2 })
})
