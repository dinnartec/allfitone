import { afterAll, beforeAll, expect, test } from 'bun:test'
import postgres from 'postgres'

// HU-STUDIO-087: an acceptance and a last-place invitation running at the same time.
//
// Accepting takes no place that was not already taken: the invitation being answered
// was pending, which is what occupies a place, and it becomes an active relationship,
// which occupies one too. That is why acceptance carries no quota check. But it only
// holds if the count sees one consistent instant. Counting the two kinds of occupant in
// two statements gives each its own snapshot under READ COMMITTED, and an acceptance
// committing in between is counted in neither: the relationship is not active yet for
// the first, and the invitation is no longer pending for the second. The place goes
// missing and the gym invites past its quota.
//
// The acceptance must always win, because refusing a person mid-flight to protect a
// number is what criterion 6 forbids. It is the invitation that has to be refused.

const OWNER_ID = '0199b400-0000-7000-8000-000000000001'
const INVITEE_ID = '0199b400-0000-7000-8000-000000000002'
const ORGANIZATION_ID = '0199b400-0000-7000-8000-000000000003'
const OWNER_MEMBERSHIP_ID = '0199b400-0000-7000-8000-000000000004'
const SCOPE_ID = '0199b400-0000-7000-8000-000000000005'

const INVITEE_CONTACT = 'accept-race@example.test'
const NEWCOMER_CONTACT = 'newcomer-race@example.test'

const SEEDED_COMMAND = '0199b400-0000-7000-8000-000000000011'
const SEEDED_KEY = 'd1111111-1111-4111-8111-111111111111'
const ACCEPT_COMMAND = '0199b400-0000-7000-8000-000000000012'
const ACCEPT_KEY = 'd2222222-2222-4222-8222-222222222222'
const INVITE_COMMAND = '0199b400-0000-7000-8000-000000000013'
const INVITE_KEY = 'd3333333-3333-4333-8333-333333333333'

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
const accepting = postgres(connectionOptions)
const inviting = postgres(connectionOptions)

async function cleanup() {
  // What the acceptance writes is append-only by trigger, so it comes out with the
  // triggers off. That also turns off the cascades, which is why it is its own
  // transaction and why everything that relies on them is in the next one.
  await admin.begin(async (transaction) => {
    await transaction`set local session_replication_role = replica`
    await transaction`delete from privacy.data_grants where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from privacy.consent_events where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from privacy.invitation_scope_options where scope_definition_id = ${SCOPE_ID}::uuid`
    await transaction`delete from privacy.scope_definitions where id = ${SCOPE_ID}::uuid`
  })
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`update organizations.organizations set status = 'closed' where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from system.outbox_events where aggregate_id in (select id from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid)`
    await transaction`delete from system.outbox_events where aggregate_id in (select id from relationships.service_relationships where organization_id = ${ORGANIZATION_ID}::uuid)`
    await transaction`delete from system.idempotency_keys where command_id in (${SEEDED_COMMAND}::uuid, ${ACCEPT_COMMAND}::uuid, ${INVITE_COMMAND}::uuid)`
    await transaction`delete from identity.invitation_intents where invitation_id in (select id from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid)`
    await transaction`delete from relationships.service_relationships where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.invitations where organization_id = ${ORGANIZATION_ID}::uuid`
    // Named rather than left to the cascade: one bad teardown orphans these and every
    // later run then fails on `uidx_membership_events_created_once` instead of on its
    // own assertions.
    await transaction`delete from organizations.membership_events where membership_id = ${OWNER_MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_events where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from organizations.membership_roles where membership_id = ${OWNER_MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_memberships where organization_id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id in (${OWNER_ID}::uuid, ${INVITEE_ID}::uuid)`
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`insert into identity.people (id, given_name, family_name) values (${OWNER_ID}::uuid, 'Race', 'Owner'), (${INVITEE_ID}::uuid, 'Race', 'Invitee')`
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party, status)
      values (
        ${ORGANIZATION_ID}::uuid,
        'gym',
        'Accept race gym',
        '{"party_kind":"legal_entity","party_name":"Race SAS","purpose":"studio_operations"}'::jsonb,
        'closed'
      )
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values (${OWNER_MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${OWNER_ID}::uuid)
    `
    await transaction`insert into organizations.membership_roles (membership_id, role_code) values (${OWNER_MEMBERSHIP_ID}::uuid, 'owner')`
    await transaction`
      insert into privacy.scope_definitions (id, scope_code, version_number, status, published_at)
      values (${SCOPE_ID}::uuid, 'body_progress', 9101, 'published', clock_timestamp())
    `
    await transaction`update organizations.organizations set status = 'active' where id = ${ORGANIZATION_ID}::uuid`
  })

  // One place, and an invitation already out for it: the gym is full before the race.
  await issue(admin, INVITEE_CONTACT, SEEDED_KEY, SEEDED_COMMAND, 'a1')
  await admin`update organizations.organizations set guest_quota_seats = 1 where id = ${ORGANIZATION_ID}::uuid`
})

afterAll(async () => {
  await cleanup()
  await Promise.all([
    admin.end({ timeout: 1 }),
    accepting.end({ timeout: 1 }),
    inviting.end({ timeout: 1 }),
  ])
})

function issue(
  client: ReturnType<typeof postgres>,
  contact: string,
  idempotencyKey: string,
  commandId: string,
  suffix: string,
) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${OWNER_ID}, true)`
    await transaction`select set_config('app.actor_org_id', ${ORGANIZATION_ID}, true)`
    await transaction`select set_config('app.request_id', gen_random_uuid()::text, true)`
    return transaction`
      select * from identity.issue_client_invitation(
        ${OWNER_ID}::uuid,
        ${ORGANIZATION_ID}::uuid,
        'email',
        ${contact},
        '[{"scope_code":"body_progress","access_level":"read","purpose":"Seguimiento","presented_snapshot":{"title":"Progreso"}}]'::jsonb,
        extensions.digest(${'token-' + contact}, 'sha256'),
        1::smallint,
        ${idempotencyKey}::uuid,
        ${commandId}::uuid,
        decode(repeat(${suffix}, 32), 'hex')
      )
    `
  })
}

// No organization context: whoever accepts holds none, and must not need any. The
// intent id arrives as an argument because the runtime role cannot read that table;
// the API learns it from the invitation-resolution read.
function accept(intentId: string) {
  return accepting.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${INVITEE_ID}, true)`
    // Only the person who proved the contact is theirs may answer the invitation.
    await transaction`select set_config('app.actor_verified_email', ${INVITEE_CONTACT}, true)`
    await transaction`select set_config('app.request_id', gen_random_uuid()::text, true)`
    return transaction`
      select * from identity.decide_client_invitation(
        ${INVITEE_ID}::uuid,
        extensions.digest(${'token-' + INVITEE_CONTACT}, 'sha256'),
        ${intentId}::uuid,
        'accepted',
        '{"body_progress":"accepted"}'::jsonb,
        ${ACCEPT_KEY}::uuid,
        ${ACCEPT_COMMAND}::uuid,
        decode(repeat('a2', 32), 'hex')
      )
    `
  })
}

test('an acceptance and a last-place invitation never put two people in one place', async () => {
  const [before] = await admin`
    select occupied from organizations.organization_guest_occupancy(${ORGANIZATION_ID}::uuid)
  `
  expect(before?.occupied).toBe(1)

  const [intent] = await admin`
    select intent.id
    from identity.invitation_intents as intent
    join identity.invitations as invitation on invitation.id = intent.invitation_id
    where invitation.organization_id = ${ORGANIZATION_ID}::uuid
      and intent.kind = 'service_relationship'
      and intent.status = 'pending'
  `

  const [accepted, invited] = await Promise.allSettled([
    accept(intent?.id),
    issue(inviting, NEWCOMER_CONTACT, INVITE_KEY, INVITE_COMMAND, 'a3'),
  ])

  // The person answering an offer the gym made is never the one who pays for the race.
  expect(accepted.status).toBe('fulfilled')

  const [after] = await admin`
    select relationships_active, invitations_pending, occupied
    from organizations.organization_guest_occupancy(${ORGANIZATION_ID}::uuid)
  `
  const [seats] = await admin`
    select guest_quota_seats from organizations.organizations where id = ${ORGANIZATION_ID}::uuid
  `

  // The whole claim, in one line: the gym never holds more than it was sold.
  expect(after?.occupied).toBeLessThanOrEqual(seats?.guest_quota_seats)

  if (invited.status === 'fulfilled') {
    // Allowed only if the acceptance had freed nothing, which it never does.
    expect(after?.occupied).toBe(1)
  } else {
    expect(invited.reason).toMatchObject({
      code: '55000',
      message: 'the gym has no places left in its guest quota',
    })
    expect(after?.relationships_active).toBe(1)
    expect(after?.invitations_pending).toBe(0)
  }
})
