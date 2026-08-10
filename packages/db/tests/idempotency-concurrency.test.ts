import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'

const PERSON_ID = '0198e200-0000-7000-8000-000000000001'
const IDEMPOTENCY_KEY = '52222222-2222-4222-8222-222222222221'
const COMMAND_ID = '0198e200-0000-7000-8000-000000000002'
const DISPLAY_NAME = 'Studio concurrency invariant fixture'
const PROFESSIONAL_PERSON_ID = '0198e200-0000-7000-8000-000000000101'
const PROFESSIONAL_PROFILE_ID = '0198e200-0000-7000-8000-000000000102'
const PROFESSIONAL_CREDENTIAL_ID = '0198e200-0000-7000-8000-000000000103'
const REVISION_COMMAND_ID = '0198e200-0000-7000-8000-000000000104'
const RETIREMENT_COMMAND_ID = '0198e200-0000-7000-8000-000000000105'

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
const firstClient = postgres(connectionOptions)
const secondClient = postgres(connectionOptions)

async function cleanupFixture(): Promise<void> {
  await admin.begin(async (transaction) => {
    await transaction`set constraints all deferred`
    await transaction`
      update organizations.organizations as organization
      set status = 'closed'
      where organization.display_name = ${DISPLAY_NAME}
    `
    await transaction`
      delete from organizations.organization_events as event
      where event.organization_id in (
        select organization.id
        from organizations.organizations as organization
        where organization.display_name = ${DISPLAY_NAME}
      )
    `
    await transaction`
      delete from organizations.membership_roles as role
      where role.membership_id in (
        select membership.id
        from organizations.organization_memberships as membership
        join organizations.organizations as organization
          on organization.id = membership.organization_id
        where organization.display_name = ${DISPLAY_NAME}
      )
    `
    await transaction`
      delete from organizations.organization_memberships as membership
      using organizations.organizations as organization
      where membership.organization_id = organization.id
        and organization.display_name = ${DISPLAY_NAME}
    `
    await transaction`
      delete from organizations.organizations as organization
      where organization.display_name = ${DISPLAY_NAME}
    `
    await transaction`
      delete from system.idempotency_keys as receipt
      where receipt.command_id = ${COMMAND_ID}::uuid
    `
    await transaction`
      delete from identity.people as person
      where person.id = ${PERSON_ID}::uuid
    `
  })
}

async function createOrganizationConcurrently(client: ReturnType<typeof postgres>) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${PERSON_ID}, true)`
    return transaction`
      select *
      from organizations.create_organization(
        ${PERSON_ID}::uuid,
        ${DISPLAY_NAME},
        'professional_practice',
        'natural_person',
        'Ignored by governed natural-person creation',
        ${IDEMPOTENCY_KEY}::uuid,
        ${COMMAND_ID}::uuid,
        decode(repeat('52', 32), 'hex')
      )
    `
  })
}

async function cleanupProfessionalFixture(): Promise<void> {
  await admin.begin(async (transaction) => {
    await transaction`
      delete from system.outbox_events
      where aggregate_id in (
        select credential.id
        from identity.professional_credentials as credential
        where credential.professional_profile_id = ${PROFESSIONAL_PROFILE_ID}::uuid
      )
    `
    await transaction`
      delete from system.idempotency_keys
      where command_id in (${REVISION_COMMAND_ID}::uuid, ${RETIREMENT_COMMAND_ID}::uuid)
    `
    await transaction`
      delete from identity.professional_credential_verifications
      where professional_credential_id in (
        select credential.id
        from identity.professional_credentials as credential
        where credential.professional_profile_id = ${PROFESSIONAL_PROFILE_ID}::uuid
      )
    `
    await transaction`
      delete from identity.professional_credentials
      where professional_profile_id = ${PROFESSIONAL_PROFILE_ID}::uuid
    `
    await transaction`
      delete from identity.professional_profile_specialties
      where professional_profile_id = ${PROFESSIONAL_PROFILE_ID}::uuid
    `
    await transaction`
      delete from identity.professional_profiles
      where id = ${PROFESSIONAL_PROFILE_ID}::uuid
    `
    await transaction`
      delete from identity.people
      where id = ${PROFESSIONAL_PERSON_ID}::uuid
    `
  })
}

async function mutateCredentialConcurrently(
  client: ReturnType<typeof postgres>,
  operation: 'revise' | 'retire',
) {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${PROFESSIONAL_PERSON_ID}, true)`
    if (operation === 'revise') {
      return transaction`
        select *
        from identity.revise_professional_credential(
          ${PROFESSIONAL_PERSON_ID}::uuid,
          ${PROFESSIONAL_CREDENTIAL_ID}::uuid,
          'professional_certification',
          'Concurrent issuer',
          'Revised credential',
          null,
          '2025-01-01'::date,
          '2030-01-01'::date,
          null,
          '61111111-1111-4111-8111-111111111111'::uuid,
          ${REVISION_COMMAND_ID}::uuid,
          decode(repeat('61', 32), 'hex')
        )
      `
    }
    return transaction`
      select *
      from identity.retire_professional_credential(
        ${PROFESSIONAL_PERSON_ID}::uuid,
        ${PROFESSIONAL_CREDENTIAL_ID}::uuid,
        '62222222-2222-4222-8222-222222222222'::uuid,
        ${RETIREMENT_COMMAND_ID}::uuid,
        decode(repeat('62', 32), 'hex')
      )
    `
  })
}

beforeAll(async () => {
  await cleanupFixture()
  await cleanupProfessionalFixture()
  await admin`
    insert into identity.people (id, given_name, family_name)
    values
      (${PERSON_ID}::uuid, 'Concurrency', 'Owner'),
      (${PROFESSIONAL_PERSON_ID}::uuid, 'Concurrency', 'Professional')
  `
  await admin`
    insert into identity.professional_profiles (id, person_id, headline, bio, practice_started_year)
    values (
      ${PROFESSIONAL_PROFILE_ID}::uuid,
      ${PROFESSIONAL_PERSON_ID}::uuid,
      'Concurrent professional',
      'Professional profile used to prove credential serialization.',
      2020
    )
  `
  await admin`
    insert into identity.professional_profile_specialties (professional_profile_id, specialty_code)
    values (${PROFESSIONAL_PROFILE_ID}::uuid, 'personal_training')
  `
  await admin`
    insert into identity.professional_credentials (
      id,
      professional_profile_id,
      credential_type_code,
      issuer,
      name
    ) values (
      ${PROFESSIONAL_CREDENTIAL_ID}::uuid,
      ${PROFESSIONAL_PROFILE_ID}::uuid,
      'professional_certification',
      'Concurrent issuer',
      'Original credential'
    )
  `
})

afterAll(async () => {
  await cleanupFixture()
  await cleanupProfessionalFixture()
  await Promise.all([
    admin.end({ timeout: 1 }),
    firstClient.end({ timeout: 1 }),
    secondClient.end({ timeout: 1 }),
  ])
})

describe('durable Studio organization idempotency', () => {
  test('two concurrent commands produce one organization, owner, and membership event', async () => {
    const [firstResult, secondResult] = await Promise.all([
      createOrganizationConcurrently(firstClient),
      createOrganizationConcurrently(secondClient),
    ])

    expect(firstResult).toHaveLength(1)
    expect(secondResult).toHaveLength(1)
    expect(firstResult[0]?.organization_id).toBe(secondResult[0]?.organization_id)

    const [counts] = await admin`
      select
        count(distinct organization.id)::integer as organizations,
        count(distinct membership.id)::integer as memberships,
        count(distinct role.id) filter (
          where role.role_code = 'owner' and role.valid_to is null
        )::integer as owners,
        count(distinct event.id) filter (
          where event.event_type = 'organization.membership_created.v1'
        )::integer as membership_events
      from organizations.organizations as organization
      left join organizations.organization_memberships as membership
        on membership.organization_id = organization.id
      left join organizations.membership_roles as role
        on role.membership_id = membership.id
      left join organizations.membership_events as event
        on event.membership_id = membership.id
      where organization.display_name = ${DISPLAY_NAME}
    `

    expect(counts).toMatchObject({
      organizations: 1,
      memberships: 1,
      owners: 1,
      membership_events: 1,
    })
  })
})

describe('professional credential concurrency', () => {
  test('revision and retirement cannot both confirm for the same active credential', async () => {
    const results = await Promise.allSettled([
      mutateCredentialConcurrently(firstClient, 'revise'),
      mutateCredentialConcurrently(secondClient, 'retire'),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)

    const [counts] = await admin`
      select
        count(*) filter (where credential.status = 'active')::integer as active_credentials,
        count(*) filter (where credential.supersedes_credential_id = ${PROFESSIONAL_CREDENTIAL_ID}::uuid)::integer as successors,
        (
          select count(*)::integer
          from system.outbox_events as event
          where event.event_type in (
            'identity.professional_credential_revised.v1',
            'identity.professional_credential_retired.v1'
          )
            and event.payload ->> 'professional_profile_id' = ${PROFESSIONAL_PROFILE_ID}
        ) as terminal_events
      from identity.professional_credentials as credential
      where credential.professional_profile_id = ${PROFESSIONAL_PROFILE_ID}::uuid
    `

    expect(counts?.active_credentials).toBeLessThanOrEqual(1)
    expect(counts?.successors).toBeLessThanOrEqual(1)
    expect(counts?.terminal_events).toBe(1)
  })
})
