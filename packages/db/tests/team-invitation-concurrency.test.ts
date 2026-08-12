import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

const PERSON_ID = '0199b200-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '0199b200-0000-7000-8000-000000000002'
const MEMBERSHIP_ID = '0199b200-0000-7000-8000-000000000003'
const FIRST_COMMAND_ID = '0199b200-0000-7000-8000-000000000011'
const SECOND_COMMAND_ID = '0199b200-0000-7000-8000-000000000012'
const FIRST_IDEMPOTENCY_KEY = 'c1111111-1111-4111-8111-111111111111'
const SECOND_IDEMPOTENCY_KEY = 'c2222222-2222-4222-8222-222222222222'
const INVITEE_ID = '0199b200-0000-7000-8000-000000000004'
const RACE_INVITATION_ID = '0199b200-0000-7000-8000-000000000013'
const DECISION_COMMAND_ID = '0199b200-0000-7000-8000-000000000014'
const REVOCATION_COMMAND_ID = '0199b200-0000-7000-8000-000000000015'

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
    await transaction`delete from system.outbox_events where aggregate_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid, ${RACE_INVITATION_ID}::uuid)`
    await transaction`delete from system.idempotency_keys where command_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid, ${RACE_INVITATION_ID}::uuid, ${DECISION_COMMAND_ID}::uuid, ${REVOCATION_COMMAND_ID}::uuid)`
    await transaction`delete from identity.invitation_intents where invitation_id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid, ${RACE_INVITATION_ID}::uuid)`
    await transaction`delete from identity.invitations where id in (${FIRST_COMMAND_ID}::uuid, ${SECOND_COMMAND_ID}::uuid, ${RACE_INVITATION_ID}::uuid)`
    await transaction`delete from organizations.organization_memberships where organization_id = ${ORGANIZATION_ID}::uuid and person_id = ${INVITEE_ID}::uuid`
    await transaction`delete from organizations.membership_roles where membership_id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_memberships where id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id in (${PERSON_ID}::uuid, ${INVITEE_ID}::uuid)`
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`insert into identity.people (id, given_name, family_name) values (${PERSON_ID}::uuid, 'Concurrent', 'Inviter')`
    await transaction`insert into identity.people (id, given_name, family_name) values (${INVITEE_ID}::uuid, 'Concurrent', 'Invitee')`
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
  contact = 'same@example.test',
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
        ${contact},
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

test('acceptance and revocation serialize so exactly one terminal effect wins', async () => {
  const [issued] = await issue(
    admin,
    RACE_INVITATION_ID,
    'c3333333-3333-4333-8333-333333333333',
    'c3',
    'race@example.test',
  )
  const intentId = String(issued?.invitation_intent_id)

  const accept = first.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${INVITEE_ID}, true)`
    await transaction`select set_config('app.actor_verified_email', 'race@example.test', true)`
    return transaction`
      select * from identity.decide_staff_invitation(
        ${INVITEE_ID}::uuid,
        decode(repeat('c3', 32), 'hex'),
        ${intentId}::uuid,
        'accepted',
        'c4444444-4444-4444-8444-444444444444'::uuid,
        ${DECISION_COMMAND_ID}::uuid,
        decode(repeat('d4', 32), 'hex')
      )
    `
  })
  const revoke = second.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${PERSON_ID}, true)`
    return transaction`
      select * from identity.revoke_staff_invitation(
        ${PERSON_ID}::uuid,
        ${ORGANIZATION_ID}::uuid,
        ${RACE_INVITATION_ID}::uuid,
        'c5555555-5555-4555-8555-555555555555'::uuid,
        ${REVOCATION_COMMAND_ID}::uuid,
        decode(repeat('d5', 32), 'hex')
      )
    `
  })

  const outcomes = await Promise.allSettled([accept, revoke])
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)

  const [state] = await admin`
    select invitation.status::text,
           count(membership.id)::integer as memberships
    from identity.invitations as invitation
    left join organizations.organization_memberships as membership
      on membership.organization_id = invitation.organization_id
     and membership.person_id = ${INVITEE_ID}::uuid
     and membership.status = 'active'
    where invitation.id = ${RACE_INVITATION_ID}::uuid
    group by invitation.status
  `
  expect(['completed', 'revoked']).toContain(state?.status)
  expect(state?.memberships).toBe(state?.status === 'completed' ? 1 : 0)
})
