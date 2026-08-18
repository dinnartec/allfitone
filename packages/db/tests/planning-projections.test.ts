/**
 * The generated DTOs prove the handlers compile against the contract; they prove
 * nothing about what PostgreSQL actually returns. These tests drive the closed
 * Planning functions on a real database and validate every projection against the
 * same OpenAPI component schemas the DTOs are generated from, so a projection
 * that drifts from the published contract fails here instead of in a client.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { allfitV1ContractSchemas } from '@allfitone/contracts'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import postgres from 'postgres'

const PERSON_ID = '019f2000-0000-7000-8000-000000000001'
const ORGANIZATION_ID = '019f2000-0000-7000-8000-000000000101'
const MEMBERSHIP_ID = '019f2000-0000-7000-8000-000000000201'
const ACTIVITY_TYPE_ID = '019c0000-0000-7000-8000-000000000011'

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
const runtime = postgres(connectionOptions)

const validator = new Ajv2020({ strict: false, allErrors: true })
addFormats(validator)
validator.addSchema({ $id: 'allfit-v1', components: { schemas: allfitV1ContractSchemas } })

function assertMatchesContract(schemaName: string, projection: unknown): void {
  const validate = validator.getSchema(`allfit-v1#/components/schemas/${schemaName}`)
  if (!validate) throw new Error(`The contract declares no schema named ${schemaName}`)
  if (validate(projection)) return
  const failures = (validate.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ')
  throw new Error(`${schemaName} projection violates the contract: ${failures}`)
}

let requestCounter = 0

/** Every audited read needs its own request id; the audit row is unique per request. */
function nextRequestId(): string {
  requestCounter += 1
  return `019f2000-0000-7000-8000-${String(900_000_000_000 + requestCounter).slice(-12)}`
}

let commandCounter = 0

function nextCommand(): { idempotencyKey: string; commandId: string; hash: Buffer } {
  commandCounter += 1
  const suffix = String(commandCounter).padStart(12, '0')
  return {
    idempotencyKey: `019f2000-0000-4000-8000-${suffix}`,
    commandId: `019f2000-0000-7000-8000-7${suffix.slice(1)}`,
    hash: Buffer.from(String(commandCounter).padStart(64, '0'), 'hex'),
  }
}

function actorTransaction<T>(
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
  requestId?: string,
): Promise<T> {
  return runtime.begin(async (transaction) => {
    await transaction`set local role allfit_api`
    await transaction`
      select set_config('app.actor_kind', 'person', true),
             set_config('app.actor_person_id', ${PERSON_ID}, true),
             set_config('app.request_id', ${requestId ?? ''}, true)
    `
    return operation(transaction)
  })
}

async function cleanup(): Promise<void> {
  // Published Planning rows are protected by immutability triggers, so only that
  // step runs as `replica`; the rest keeps foreign-key cascades working.
  await admin.begin(async (transaction) => {
    await transaction`set local session_replication_role = replica`
    await transaction`
      delete from planning.program_versions where program_id in (
        select id from planning.programs where owner_organization_id = ${ORGANIZATION_ID}::uuid
      )
    `
    await transaction`
      delete from planning.session_template_versions where template_id in (
        select id from planning.session_templates where owner_organization_id = ${ORGANIZATION_ID}::uuid
      )
    `
  })
  await admin.begin(async (transaction) => {
    await transaction`
      delete from privacy.access_events where subject_organization_id = ${ORGANIZATION_ID}::uuid
    `
    await transaction`
      delete from system.outbox_events where aggregate_id in (
        select id from planning.programs where owner_organization_id = ${ORGANIZATION_ID}::uuid
        union all
        select version.id from planning.program_versions as version
        join planning.programs as program on program.id = version.program_id
        where program.owner_organization_id = ${ORGANIZATION_ID}::uuid
        union all
        select id from planning.session_templates where owner_organization_id = ${ORGANIZATION_ID}::uuid
        union all
        select version.id from planning.session_template_versions as version
        join planning.session_templates as template on template.id = version.template_id
        where template.owner_organization_id = ${ORGANIZATION_ID}::uuid
      )
    `
    await transaction`
      delete from system.idempotency_keys
      where key between '019f2000-0000-4000-8000-000000000000'::uuid
        and '019f2000-0000-4000-8000-ffffffffffff'::uuid
    `
    await transaction`
      delete from planning.programs where owner_organization_id = ${ORGANIZATION_ID}::uuid
    `
    await transaction`
      delete from planning.session_templates where owner_organization_id = ${ORGANIZATION_ID}::uuid
    `
    await transaction`delete from organizations.membership_roles where membership_id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organization_memberships where id = ${MEMBERSHIP_ID}::uuid`
    await transaction`delete from organizations.organizations where id = ${ORGANIZATION_ID}::uuid`
    await transaction`delete from identity.people where id = ${PERSON_ID}::uuid`
  })
}

interface Projections {
  sessionTemplate: unknown
  sessionTemplateDraft: unknown
  sessionTemplateVersion: unknown
  readSessionTemplateVersion: unknown
  derivedSessionTemplateDraft: unknown
  deprecatedSessionTemplateVersion: unknown
  program: unknown
  programDraft: unknown
  programVersion: unknown
  deprecatedProgramVersion: unknown
  sessionTemplatePage: unknown[]
  programPage: unknown[]
}

const projections = {} as Projections

const stepContent = {
  position: 1,
  target: { family: 'strength', target_sets: 3, target_reps: 8, target_rpe: 7 },
}

beforeAll(async () => {
  await cleanup()
  await admin.begin(async (transaction) => {
    await transaction`
      insert into identity.people (id, given_name, family_name)
      values (${PERSON_ID}::uuid, 'Paula', 'Projection')
    `
    await transaction`
      insert into organizations.organizations (id, type_code, display_name, responsible_party)
      values (${ORGANIZATION_ID}::uuid, 'studio', 'Projection studio',
        '{"party_kind":"legal_entity","party_name":"Projection studio","purpose":"studio_operations"}')
    `
    await transaction`
      insert into organizations.organization_memberships (id, organization_id, person_id)
      values (${MEMBERSHIP_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${PERSON_ID}::uuid)
    `
    await transaction`
      insert into organizations.membership_roles (membership_id, role_code)
      values (${MEMBERSHIP_ID}::uuid, 'owner')
    `
  })

  const created = nextCommand()
  const [templateRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.create_session_template(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'test_strength', 'Projection template',
        ${created.idempotencyKey}::uuid, ${created.commandId}::uuid, ${created.hash})
    `,
  )
  projections.sessionTemplate = templateRow?.result
  const templateId = templateRow?.result.id
  const templateEtag = templateRow?.result.draft.etag

  const drafted = nextCommand()
  const [draftRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.replace_session_template_draft(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${templateId}::uuid, ${templateEtag},
        ${transaction.json({ title: 'Projection template', activity_type_id: ACTIVITY_TYPE_ID, steps: [stepContent] })}::jsonb,
        ${drafted.idempotencyKey}::uuid, ${drafted.commandId}::uuid, ${drafted.hash})
    `,
  )
  projections.sessionTemplateDraft = draftRow?.result

  const published = nextCommand()
  const [versionRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.publish_session_template_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${templateId}::uuid,
        ${draftRow?.result.etag}, ${published.idempotencyKey}::uuid,
        ${published.commandId}::uuid, ${published.hash})
    `,
  )
  projections.sessionTemplateVersion = versionRow?.result
  const templateVersionId = versionRow?.result.id

  const [readRow] = await actorTransaction(
    (transaction) => transaction`
      select planning.read_session_template_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${templateId}::uuid, 1) as result
    `,
    nextRequestId(),
  )
  projections.readSessionTemplateVersion = readRow?.result

  const derived = nextCommand()
  const [derivedRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.derive_session_template_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${templateId}::uuid, 1,
        ${draftRow?.result.etag}, ${derived.idempotencyKey}::uuid,
        ${derived.commandId}::uuid, ${derived.hash})
    `,
  )
  projections.derivedSessionTemplateDraft = derivedRow?.result

  const createdProgram = nextCommand()
  const [programRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.create_program(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, 'Projection program',
        ${createdProgram.idempotencyKey}::uuid, ${createdProgram.commandId}::uuid,
        ${createdProgram.hash})
    `,
  )
  projections.program = programRow?.result
  const programId = programRow?.result.id

  const draftedProgram = nextCommand()
  const [programDraftRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.replace_program_draft(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${programId}::uuid,
        ${programRow?.result.draft.etag},
        ${transaction.json({
          title: 'Projection program',
          notes: null,
          sessions: [{ position: 1, week: 1, day: 1, template_version_id: templateVersionId }],
        })}::jsonb,
        ${draftedProgram.idempotencyKey}::uuid, ${draftedProgram.commandId}::uuid,
        ${draftedProgram.hash})
    `,
  )
  projections.programDraft = programDraftRow?.result

  const publishedProgram = nextCommand()
  const [programVersionRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.publish_program_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${programId}::uuid,
        ${programDraftRow?.result.etag}, ${publishedProgram.idempotencyKey}::uuid,
        ${publishedProgram.commandId}::uuid, ${publishedProgram.hash})
    `,
  )
  projections.programVersion = programVersionRow?.result

  const listedTemplates = await actorTransaction(
    (transaction) => transaction`
      select result from planning.list_session_templates(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, 25, null, null)
    `,
    nextRequestId(),
  )
  projections.sessionTemplatePage = listedTemplates.map((row) => row.result)

  const listedPrograms = await actorTransaction(
    (transaction) => transaction`
      select result from planning.list_programs(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, 25, null, null)
    `,
    nextRequestId(),
  )
  projections.programPage = listedPrograms.map((row) => row.result)

  const deprecatedProgram = nextCommand()
  const [deprecatedProgramRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.deprecate_program_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${programId}::uuid, 1,
        ${deprecatedProgram.idempotencyKey}::uuid, ${deprecatedProgram.commandId}::uuid,
        ${deprecatedProgram.hash})
    `,
  )
  projections.deprecatedProgramVersion = deprecatedProgramRow?.result

  const deprecatedTemplate = nextCommand()
  const [deprecatedTemplateRow] = await actorTransaction(
    (transaction) => transaction`
      select result from planning.deprecate_session_template_version(
        ${PERSON_ID}::uuid, ${ORGANIZATION_ID}::uuid, ${templateId}::uuid, 1,
        ${deprecatedTemplate.idempotencyKey}::uuid, ${deprecatedTemplate.commandId}::uuid,
        ${deprecatedTemplate.hash})
    `,
  )
  projections.deprecatedSessionTemplateVersion = deprecatedTemplateRow?.result
})

afterAll(async () => {
  await cleanup()
  await Promise.all([admin.end({ timeout: 1 }), runtime.end({ timeout: 1 })])
})

describe('Planning projections against the OpenAPI contract', () => {
  test('T-PLN-API-050 the contract publishes every Planning schema these tests assert', () => {
    for (const schemaName of [
      'SessionTemplate',
      'SessionTemplateDraft',
      'SessionTemplateVersion',
      'Program',
      'ProgramDraft',
      'ProgramVersion',
    ]) {
      expect(validator.getSchema(`allfit-v1#/components/schemas/${schemaName}`)).toBeDefined()
    }
  })

  test('T-PLN-API-051 a rejected projection proves the validator is not permissive', () => {
    expect(() =>
      assertMatchesContract('SessionTemplateVersion', {
        ...(projections.sessionTemplateVersion as Record<string, unknown>),
        status: 'retired',
      }),
    ).toThrow(/status/)
    expect(() => assertMatchesContract('SessionTemplateVersion', {})).toThrow()
  })

  const cases: Array<{ id: string; schema: string; projection: () => unknown }> = [
    {
      id: 'T-PLN-API-052',
      schema: 'SessionTemplate',
      projection: () => projections.sessionTemplate,
    },
    {
      id: 'T-PLN-API-053',
      schema: 'SessionTemplateDraft',
      projection: () => projections.sessionTemplateDraft,
    },
    {
      id: 'T-PLN-API-054',
      schema: 'SessionTemplateVersion',
      projection: () => projections.sessionTemplateVersion,
    },
    {
      id: 'T-PLN-API-055',
      schema: 'SessionTemplateVersion',
      projection: () => projections.readSessionTemplateVersion,
    },
    {
      id: 'T-PLN-API-056',
      schema: 'SessionTemplateDraft',
      projection: () => projections.derivedSessionTemplateDraft,
    },
    {
      id: 'T-PLN-API-057',
      schema: 'SessionTemplateVersion',
      projection: () => projections.deprecatedSessionTemplateVersion,
    },
    { id: 'T-PLN-API-058', schema: 'Program', projection: () => projections.program },
    { id: 'T-PLN-API-059', schema: 'ProgramDraft', projection: () => projections.programDraft },
    { id: 'T-PLN-API-060', schema: 'ProgramVersion', projection: () => projections.programVersion },
    {
      id: 'T-PLN-API-061',
      schema: 'ProgramVersion',
      projection: () => projections.deprecatedProgramVersion,
    },
  ]

  for (const testCase of cases) {
    test(`${testCase.id} the runtime ${testCase.schema} projection satisfies its contract schema`, () => {
      const projection = testCase.projection()
      expect(projection).toBeDefined()
      assertMatchesContract(testCase.schema, projection)
    })
  }

  test('T-PLN-API-062 every listed session template satisfies the contract schema', () => {
    expect(projections.sessionTemplatePage.length).toBeGreaterThan(0)
    for (const item of projections.sessionTemplatePage) {
      assertMatchesContract('SessionTemplate', item)
    }
  })

  test('T-PLN-API-063 every listed program satisfies the contract schema', () => {
    expect(projections.programPage.length).toBeGreaterThan(0)
    for (const item of projections.programPage) {
      assertMatchesContract('Program', item)
    }
  })
})
