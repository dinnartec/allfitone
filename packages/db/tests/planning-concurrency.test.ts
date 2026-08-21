import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import postgres from 'postgres'

const PERSON_ID = '019f1000-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '019f1000-0000-7000-8000-000000000101'
const MEMBERSHIP_ID = '019f1000-0000-7000-8000-000000000201'
const COMPOSITION_TEMPLATE_ID = '019f1000-0000-7000-8000-000000000301'
const COMPOSITION_DRAFT_ID = '019f1000-0000-7000-8000-000000000302'
const COMPOSITION_VERSION_ID = '019f1000-0000-7000-8000-000000000303'
const DERIVATION_TEMPLATE_ID = '019f1000-0000-7000-8000-000000000311'
const DERIVATION_DRAFT_ID = '019f1000-0000-7000-8000-000000000312'
const DERIVATION_VERSION_ID = '019f1000-0000-7000-8000-000000000313'
const PROGRAM_ID = '019f1000-0000-7000-8000-000000000401'
const PROGRAM_DRAFT_ID = '019f1000-0000-7000-8000-000000000402'

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
const retirementClient = postgres(connectionOptions)
const contentClient = postgres(connectionOptions)
let programEtag = ''
let derivationEtag = ''

async function cleanup(): Promise<void> {
  // Published Planning rows are protected by immutability triggers, so only that
  // step runs as `replica`; foreign-key cascades stay live for everything else,
  // which is what removes the membership event rows and keeps this re-runnable.
  await admin.begin(async (transaction) => {
    await transaction`set local session_replication_role = replica`
    await transaction`
      delete from planning.session_template_versions
      where id in (${COMPOSITION_VERSION_ID}::uuid, ${DERIVATION_VERSION_ID}::uuid)
    `
  })
  await admin.begin(async (transaction) => {
    await transaction`
      delete from system.outbox_events
      where aggregate_id in (
        ${COMPOSITION_VERSION_ID}::uuid, ${DERIVATION_VERSION_ID}::uuid,
        ${COMPOSITION_TEMPLATE_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid,
        ${PROGRAM_ID}::uuid, ${PROGRAM_DRAFT_ID}::uuid
      )
    `
    await transaction`
      delete from system.idempotency_keys
      where command_id between '019f1000-0000-7000-8000-000000000501'::uuid
        and '019f1000-0000-7000-8000-000000000504'::uuid
    `
    await transaction`
      delete from planning.program_drafts where id = ${PROGRAM_DRAFT_ID}::uuid
    `
    await transaction`
      delete from planning.programs where id = ${PROGRAM_ID}::uuid
    `
    await transaction`
      delete from planning.session_template_drafts
      where id in (${COMPOSITION_DRAFT_ID}::uuid, ${DERIVATION_DRAFT_ID}::uuid)
    `
    await transaction`
      delete from planning.session_templates
      where id in (${COMPOSITION_TEMPLATE_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid)
    `
    await transaction`delete from organizations.membership_roles where membership_id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_memberships where id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id = ${PERSON_ID}::uuid`
  })
}

async function actorTransaction<T>(
  client: ReturnType<typeof postgres>,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return client.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`select set_config('app.actor_kind', 'person', true)`
    await transaction`select set_config('app.actor_person_id', ${PERSON_ID}, true)`
    return operation(transaction)
  })
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`
      insert into identity.people (id, given_name, family_name)
      values (${PERSON_ID}::uuid, 'Planning', 'Concurrency')
    `
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party)
      values (${ORGANIZATION_ID}::uuid, 'studio', 'Planning concurrency studio',
        '{"party_kind":"legal_entity","party_name":"Planning concurrency studio","purpose":"studio_operations"}')
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values (${MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${PERSON_ID}::uuid)
    `
    await transaction`
      insert into organizations.membership_roles (membership_id, role_code)
      values (${MEMBERSHIP_ID}::uuid, 'owner')
    `
    await transaction`
      insert into planning.session_templates (id, owner_organization_id, discipline_code, author_person_id, status)
      values
        (${COMPOSITION_TEMPLATE_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'test_strength', ${PERSON_ID}::uuid, 'published'),
        (${DERIVATION_TEMPLATE_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'test_strength', ${PERSON_ID}::uuid, 'published')
    `
    await transaction`
      insert into planning.session_template_drafts (id, template_id, content)
      values
        (${COMPOSITION_DRAFT_ID}::uuid, ${COMPOSITION_TEMPLATE_ID}::uuid,
          '{"title":"Composition","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[]}'::jsonb),
        (${DERIVATION_DRAFT_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid,
          '{"title":"Derivation","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[]}'::jsonb)
    `
    await transaction`
      insert into planning.session_template_versions (
        id, template_id, version_number, discipline_code, activity_type_id, title, content_hash
      ) values
        (${COMPOSITION_VERSION_ID}::uuid, ${COMPOSITION_TEMPLATE_ID}::uuid, 1, 'test_strength',
          '019c0000-0000-7000-8000-000000000011'::uuid, 'Composition', decode(repeat('c1', 32), 'hex')),
        (${DERIVATION_VERSION_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid, 1, 'test_strength',
          '019c0000-0000-7000-8000-000000000011'::uuid, 'Derivation', decode(repeat('d1', 32), 'hex'))
    `
    await transaction`
      insert into planning.programs (id, owner_organization_id, author_person_id)
      values (${PROGRAM_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${PERSON_ID}::uuid)
    `
    await transaction`
      insert into planning.program_drafts (id, program_id, content)
      values (${PROGRAM_DRAFT_ID}::uuid, ${PROGRAM_ID}::uuid,
        '{"title":"Concurrent program","notes":null,"sessions":[]}'::jsonb)
    `
  })
  const [etags] = await admin`
    select
      planning.content_etag('{"title":"Concurrent program","notes":null,"sessions":[]}'::jsonb) as program_etag,
      planning.content_etag('{"title":"Derivation","activity_type_id":"019c0000-0000-7000-8000-000000000011","steps":[]}'::jsonb) as derivation_etag
  `
  programEtag = etags?.program_etag
  derivationEtag = etags?.derivation_etag
})

afterAll(async () => {
  await cleanup()
  await Promise.all([
    admin.end({ timeout: 1 }),
    retirementClient.end({ timeout: 1 }),
    contentClient.end({ timeout: 1 }),
  ])
})

describe('Planning retirement serialization', () => {
  test('T-PLN-CONC-01 retirement commits before a new program composition validates', async () => {
    let releaseRetirement: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseRetirement = resolve
    })
    let retirementLocked: (() => void) | undefined
    const locked = new Promise<void>((resolve) => {
      retirementLocked = resolve
    })
    const retirement = actorTransaction(retirementClient, async (transaction) => {
      await transaction`
        select * from planning.deprecate_session_template_version(
          ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${COMPOSITION_TEMPLATE_ID}::uuid, 1,
          '71111111-1111-4111-8111-111111111111'::uuid,
          '019f1000-0000-7000-8000-000000000501'::uuid, decode(repeat('71', 32), 'hex'))
      `
      retirementLocked?.()
      await release
    })
    await locked
    let settled = false
    const composition = actorTransaction(
      contentClient,
      (transaction) => transaction`
      select * from planning.replace_program_draft(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${PROGRAM_ID}::uuid,
        ${programEtag},
        jsonb_build_object('title', 'Concurrent program', 'notes', null, 'sessions', jsonb_build_array(
          jsonb_build_object('position', 1, 'week', 1, 'day', 1,
            'template_version_id', ${COMPOSITION_VERSION_ID}::uuid))),
        '72222222-2222-4222-8222-222222222222'::uuid,
        '019f1000-0000-7000-8000-000000000502'::uuid, decode(repeat('72', 32), 'hex'))
    `,
    ).finally(() => {
      settled = true
    })
    await Bun.sleep(100)
    const settledBeforeRetirement = settled
    releaseRetirement?.()
    expect(settledBeforeRetirement).toBeFalse()
    await retirement
    await expect(composition).rejects.toMatchObject({ code: '22023' })
  })

  test('T-PLN-CONC-02 retirement commits before derivation validates its source', async () => {
    let releaseRetirement: (() => void) | undefined
    const release = new Promise<void>((resolve) => {
      releaseRetirement = resolve
    })
    let retirementLocked: (() => void) | undefined
    const locked = new Promise<void>((resolve) => {
      retirementLocked = resolve
    })
    const retirement = actorTransaction(retirementClient, async (transaction) => {
      await transaction`
        select * from planning.deprecate_session_template_version(
          ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid, 1,
          '73333333-3333-4333-8333-333333333333'::uuid,
          '019f1000-0000-7000-8000-000000000503'::uuid, decode(repeat('73', 32), 'hex'))
      `
      retirementLocked?.()
      await release
    })
    await locked
    let settled = false
    const derivation = actorTransaction(
      contentClient,
      (transaction) => transaction`
      select * from planning.derive_session_template_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${DERIVATION_TEMPLATE_ID}::uuid, 1,
        ${derivationEtag},
        '74444444-4444-4444-8444-444444444444'::uuid,
        '019f1000-0000-7000-8000-000000000504'::uuid, decode(repeat('74', 32), 'hex'))
    `,
    ).finally(() => {
      settled = true
    })
    await Bun.sleep(100)
    const settledBeforeRetirement = settled
    releaseRetirement?.()
    expect(settledBeforeRetirement).toBeFalse()
    await retirement
    await expect(derivation).rejects.toMatchObject({ code: 'P0002' })
  })
})
