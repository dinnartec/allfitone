import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  PlanningCommandResult,
  PlanningDatabase,
  Program,
  ProgramDraft,
  ProgramVersion,
  SessionTemplate,
  SessionTemplateDraft,
  SessionTemplateVersion,
} from '../domain/index.js'

// Draft content travels through `transaction.json`: a pre-stringified value binds
// as a JSON string, and the content functions reject it as an invalid shape.
type CommandRow<T> = { result: T; replayed: boolean }
type PageRow<T> = { result: T; updated_at: Date; resource_id: string }

export function createPlanningDatabase(): PlanningDatabase {
  const sql = database()
  return {
    createSessionTemplate: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<SessionTemplate>[]>`
          select * from planning.create_session_template(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.disciplineCode}, ${input.title}, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'create session template')
      }),
    replaceSessionTemplateDraft: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<SessionTemplateDraft>[]>`
          select * from planning.replace_session_template_draft(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.templateId}::uuid, ${input.expectedEtag},
            ${transaction.json(input.content)}::jsonb, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'replace session template draft')
      }),
    publishSessionTemplateVersion: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<SessionTemplateVersion>[]>`
          select * from planning.publish_session_template_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.templateId}::uuid, ${input.expectedEtag},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'publish session template version')
      }),
    deriveSessionTemplateVersion: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<SessionTemplateDraft>[]>`
          select * from planning.derive_session_template_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.templateId}::uuid, ${input.versionNumber}::integer,
            ${input.expectedEtag}, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'derive session template version')
      }),
    deprecateSessionTemplateVersion: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<SessionTemplateVersion>[]>`
          select * from planning.deprecate_session_template_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.templateId}::uuid, ${input.versionNumber}::integer,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'deprecate session template version')
      }),
    createProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<Program>[]>`
          select * from planning.create_program(
            ${input.personId}::uuid, ${input.organizationId}::uuid, ${input.title},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'create program')
      }),
    replaceProgramDraft: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<ProgramDraft>[]>`
          select * from planning.replace_program_draft(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.programId}::uuid, ${input.expectedEtag},
            ${transaction.json(input.content)}::jsonb, ${input.idempotencyKey}::uuid,
            ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'replace program draft')
      }),
    publishProgramVersion: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<ProgramVersion>[]>`
          select * from planning.publish_program_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.programId}::uuid, ${input.expectedEtag},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'publish program version')
      }),
    deprecateProgramVersion: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<CommandRow<ProgramVersion>[]>`
          select * from planning.deprecate_program_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.programId}::uuid, ${input.versionNumber}::integer,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return requiredCommand(row, 'deprecate program version')
      }),
    listSessionTemplates: (input) =>
      query(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<
          Array<{ result: SessionTemplate; updated_at: Date; template_id: string }>
        >`
          select * from planning.list_session_templates(
            ${input.personId}::uuid, ${input.organizationId}::uuid, ${input.limit + 1}::integer,
            ${input.cursor?.updatedAt ?? null}::timestamptz, ${input.cursor?.id ?? null}::uuid
          )
        `
        return page(
          rows.map((row) => ({
            result: row.result,
            updated_at: row.updated_at,
            resource_id: row.template_id,
          })),
          input.limit,
        )
      }),
    listPrograms: (input) =>
      query(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<
          Array<{ result: Program; updated_at: Date; program_id: string }>
        >`
          select * from planning.list_programs(
            ${input.personId}::uuid, ${input.organizationId}::uuid, ${input.limit + 1}::integer,
            ${input.cursor?.updatedAt ?? null}::timestamptz, ${input.cursor?.id ?? null}::uuid
          )
        `
        return page(
          rows.map((row) => ({
            result: row.result,
            updated_at: row.updated_at,
            resource_id: row.program_id,
          })),
          input.limit,
        )
      }),
    readSessionTemplateVersion: (input) =>
      query(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ result: SessionTemplateVersion }[]>`
          select planning.read_session_template_version(
            ${input.personId}::uuid, ${input.organizationId}::uuid,
            ${input.templateId}::uuid, ${input.versionNumber}::integer
          ) as result
        `
        if (!row) throw new Error('PostgreSQL did not return the session template version')
        return row.result
      }),
  }
}

function command<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureStudioRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await setActor(transaction, personId)
      return { value: await operation(transaction) }
    })
    return result.value
  })
}

function query<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureStudioRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await setActor(transaction, personId, requestId)
      return { value: await operation(transaction) }
    })
    return result.value
  })
}

async function setActor(
  transaction: postgres.TransactionSql,
  personId: string,
  requestId?: string,
): Promise<void> {
  await transaction`
    select set_config('app.actor_kind', 'person', true),
           set_config('app.actor_person_id', ${personId}, true),
           set_config('app.request_id', ${requestId ?? ''}, true)
  `
}

function requiredCommand<T>(
  row: CommandRow<T> | undefined,
  operation: string,
): PlanningCommandResult<T> {
  if (!row) throw new Error(`PostgreSQL did not ${operation}`)
  return { resource: row.result, replayed: row.replayed }
}

function page<T>(rows: Array<PageRow<T>>, limit: number) {
  const hasMore = rows.length > limit
  const visible = rows.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map((row) => row.result),
    hasMore,
    ...(hasMore && last
      ? { nextCursor: { updatedAt: last.updated_at.toISOString(), id: last.resource_id } }
      : {}),
  }
}
