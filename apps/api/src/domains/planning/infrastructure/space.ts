/**
 * PostgreSQL access for the Space planning surface.
 *
 * Every call goes through a closed function. The runtime role has **no privilege at
 * all** on the planning tables — not even `select` — so there is no query here that
 * could accidentally widen what a person reads.
 *
 * `read_current_assignment` and `read_training_profile` return zero or one row, and
 * absence is a real answer in both cases: nobody has chosen yet, or nothing was
 * declared. Neither is an error.
 */

import type postgres from 'postgres'

import { database } from '../../../platform/db/index.js'
import { measureStudioRequestPhase } from '../../../platform/observability/index.js'
import type {
  Program,
  ProgramDraft,
  ProgramVersion,
  SessionTemplate,
  SessionTemplateDraft,
  SessionTemplateVersion,
  StoredMyProgram,
  ProgramCover,
  StoredMyRoutine,
  WeekPlan,
  ProgramAssignment,
  SpacePlanningDatabase,
  StoredProgramDetail,
  StoredProgramSummary,
  TrainingProfile,
} from '../domain/space.js'

interface CatalogueRow {
  program_version_id: string
  program_id: string
  title: string
  // Null is the version without an end date: no last week to count to.
  weeks: number | null
  days_per_week: number
  sex_affinity: 'male' | 'female' | null
  goals: string[]
  levels: string[]
  emphases: string[]
  // La clave y no la dirección: componerla es trabajo de la superficie.
  cover_object_key: string | null
}

interface AssignmentRow {
  assignment_id: string
  program_version_id: string
  title: string
  starts_on: Date | string
  timezone: string
  sessions_planned: number
}

interface DetailRow {
  program_version_id: string
  title: string
  notes: string | null
  // Null is the version without an end date: no last week to count to.
  weeks: number | null
  days_per_week: number
  sex_affinity: 'male' | 'female' | null
  goals: string[]
  levels: string[]
  emphases: string[]
  days: StoredProgramDetail['days']
  cover_object_key: string | null
}

interface TodayRow {
  planned_session_id: string
  program_title: string
  session_title: string
  discipline_code: string
  status: string
  exercise_count: number
  executed_session_id: string | null
}

interface WeekPlanRow {
  assignment_id: string
  program_version_id: string
  program_title: string
  program_week: number
  week_starts_on: Date | string
  sessions: WeekPlan['sessions']
}

interface MyProgramRow extends Omit<StoredMyProgram, 'starts_on'> {
  starts_on: Date | string
}

interface ProfileRow {
  given_name: string
  primary_training_goal: string | null
  training_experience: string | null
  biological_sex: string | null
  focus_areas: string[]
}

const EMPTY_PROFILE: TrainingProfile = {
  given_name: '',
  primary_training_goal: null,
  training_experience: null,
  biological_sex: null,
  focus_areas: [],
}

export function createSpacePlanningDatabase(): SpacePlanningDatabase {
  const sql = database()

  return {
    readProgramCatalogue: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<CatalogueRow[]>`
          select * from planning.read_program_catalogue(${input.personId}::uuid)
        `
        return rows.map(summary)
      }),

    readCurrentAssignment: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<AssignmentRow[]>`
          select * from planning.read_current_assignment(${input.personId}::uuid)
        `
        return row ? assignment(row) : null
      }),

    readTrainingProfile: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<ProfileRow[]>`
          select * from identity.read_training_profile(${input.personId}::uuid)
        `
        return row ? profile(row) : EMPTY_PROFILE
      }),

    readProgramVersion: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<DetailRow[]>`
          select * from planning.read_program_version(
            ${input.personId}::uuid, ${input.programVersionId}::uuid
          )
        `
        return row ? detail(row) : null
      }),

    readWeekPlan: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<WeekPlanRow[]>`
          select * from planning.read_week_plan(${input.personId}::uuid, ${input.timezone})
        `
        return row
          ? {
              assignment_id: row.assignment_id,
              program_version_id: row.program_version_id,
              program_title: row.program_title,
              program_week: row.program_week,
              week_starts_on: date(row.week_starts_on),
              sessions: row.sessions ?? [],
            }
          : null
      }),

    readMyPrograms: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const rows = await transaction<MyProgramRow[]>`
          select * from planning.read_my_programs(${input.personId}::uuid)
        `
        return rows.map((row) => ({ ...row, starts_on: date(row.starts_on) }))
      }),

    readMyContent: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ mine: readonly StoredMyRoutine[] }[]>`
          select planning.read_my_content(${input.personId}::uuid) as mine
        `
        return row?.mine ?? []
      }),

    createMySessionTemplate: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ template: SessionTemplate }[]>`
          select template from planning.create_my_session_template(
            ${input.personId}::uuid, ${input.disciplineCode}, ${input.title},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.template, 'create the session template')
      }),

    replaceMySessionTemplateDraft: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ draft: SessionTemplateDraft }[]>`
          select draft from planning.replace_my_session_template_draft(
            ${input.personId}::uuid, ${input.templateId}::uuid, ${input.expectedEtag},
            ${JSON.stringify(input.content)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.draft, 'replace the draft')
      }),

    publishMySessionTemplate: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ version: SessionTemplateVersion }[]>`
          select version from planning.publish_my_session_template(
            ${input.personId}::uuid, ${input.templateId}::uuid, ${input.expectedEtag},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.version, 'publish the session template')
      }),

    readMySessionTemplateDraft: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ draft: SessionTemplateDraft | null }[]>`
          select planning.read_my_session_template_draft(
            ${input.personId}::uuid, ${input.templateId}::uuid
          ) as draft
        `
        return row?.draft ?? null
      }),

    discardMySessionTemplate: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ template: SessionTemplate }[]>`
          select template from planning.discard_my_session_template(
            ${input.personId}::uuid, ${input.templateId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.template, 'discard the session template')
      }),

    readMyUnpublishedProgram: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ program: Program | null }[]>`
          select planning.read_my_unpublished_program(${input.personId}::uuid) as program
        `
        return row?.program ?? null
      }),

    discardMyProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ program: Program }[]>`
          select program from planning.discard_my_program(
            ${input.personId}::uuid, ${input.programId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.program, 'discard the program')
      }),

    removeMyProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ program: Program }[]>`
          select program from planning.remove_my_program(
            ${input.personId}::uuid, ${input.programId}::uuid, ${input.withRoutines},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.program, 'remove the program')
      }),

    // Contesta el programa **nuevo**. El original no se toca y no se acuña ninguna
    // versión: la copia es un borrador hasta que alguien la publique.
    duplicateMyProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ program: Program }[]>`
          select program from planning.duplicate_my_program(
            ${input.personId}::uuid, ${input.programId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.program, 'duplicate the program')
      }),

    createMyProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ program: Program }[]>`
          select program from planning.create_my_program(
            ${input.personId}::uuid, ${input.title},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.program, 'create the program')
      }),

    replaceMyProgramDraft: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ draft: ProgramDraft }[]>`
          select draft from planning.replace_my_program_draft(
            ${input.personId}::uuid, ${input.programId}::uuid, ${input.expectedEtag},
            ${JSON.stringify(input.content)}::text::jsonb,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.draft, 'replace the draft')
      }),

    readMyProgramDraft: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<{ draft: ProgramDraft | null }[]>`
          select planning.read_my_program_draft(
            ${input.personId}::uuid, ${input.programId}::uuid
          ) as draft
        `
        return row?.draft ?? null
      }),

    /**
     * Answers nothing on purpose. The command is a consequence of publishing, not a
     * request of its own, and a programme somebody wrote and never took has no agenda
     * to restate — that is a no-op, not a failure.
     */
    restateMyProgramAssignment: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ assignment: string | null }[]>`
          select planning.restate_my_program_assignment(
            ${input.personId}::uuid, ${input.programVersionId}::uuid,
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as assignment
        `
        return row?.assignment ?? null
      }),

    publishMyProgram: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ version: ProgramVersion }[]>`
          select version from planning.publish_my_program(
            ${input.personId}::uuid, ${input.programId}::uuid, ${input.expectedEtag},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        return answered(row?.version, 'publish the program')
      }),

    setMyProgramCover: (input) =>
      command(sql, input.personId, async (transaction) => {
        const [row] = await transaction<{ cover: ProgramCover }[]>`
          select planning.set_my_program_cover(
            ${input.personId}::uuid, ${input.programId}::uuid,
            ${input.cover?.kind ?? null}, ${input.cover?.kind === 'icon' ? input.cover.icon : null},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as cover
        `
        return answered(row?.cover, 'dress the program')
      }),

    reorderMyPrograms: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        await transaction`
          select planning.reorder_my_programs(
            ${input.personId}::uuid, ${input.assignmentIds as string[]}::uuid[],
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          )
        `
        // Answered from the same transaction: the client renders what it just wrote,
        // not what it hoped it wrote.
        const rows = await transaction<MyProgramRow[]>`
          select * from planning.read_my_programs(${input.personId}::uuid)
        `
        return rows.map((row) => ({ ...row, starts_on: date(row.starts_on) }))
      }),

    readTodaySession: (input) =>
      transact(sql, input.personId, input.requestId, async (transaction) => {
        const [row] = await transaction<TodayRow[]>`
          select * from planning.read_today_session(${input.personId}::uuid, ${input.timezone})
        `
        return row
          ? {
              planned_session_id: row.planned_session_id,
              program_title: row.program_title,
              session_title: row.session_title,
              discipline_code: row.discipline_code,
              status: row.status,
              exercise_count: row.exercise_count,
              executed_session_id: row.executed_session_id,
            }
          : null
      }),

    selfAssignProgram: (input) =>
      transact(sql, input.personId, '', async (transaction) => {
        const [chosen] = await transaction<{ assignment_id: string }[]>`
          select planning.self_assign_program(
            ${input.personId}::uuid, ${input.programVersionId}::uuid, ${input.timezone},
            ${input.idempotencyKey}::uuid, ${input.commandId}::uuid, ${input.requestHash}
          ) as assignment_id
        `
        if (!chosen) throw new Error('PostgreSQL did not assign the program')

        // Read back in the same transaction: the answer has to describe the calendar
        // that was just written, and a replay has to describe the one that already was.
        const [row] = await transaction<AssignmentRow[]>`
          select * from planning.read_current_assignment(${input.personId}::uuid)
        `
        if (!row) throw new Error('PostgreSQL did not return the assignment')
        return assignment(row)
      }),
  }
}

function summary(row: CatalogueRow): StoredProgramSummary {
  return {
    program_version_id: row.program_version_id,
    program_id: row.program_id,
    title: row.title,
    weeks: row.weeks,
    days_per_week: row.days_per_week,
    sex_affinity: row.sex_affinity,
    goals: row.goals as StoredProgramSummary['goals'],
    levels: row.levels as StoredProgramSummary['levels'],
    emphases: row.emphases as StoredProgramSummary['emphases'],
    cover_object_key: row.cover_object_key,
  }
}

function assignment(row: AssignmentRow): ProgramAssignment {
  return {
    assignment_id: row.assignment_id,
    program_version_id: row.program_version_id,
    title: row.title,
    // `date` comes back as a Date in the local zone; the calendar day is what matters.
    starts_on:
      row.starts_on instanceof Date ? row.starts_on.toISOString().slice(0, 10) : row.starts_on,
    timezone: row.timezone,
    sessions_planned: row.sessions_planned,
  }
}

function detail(row: DetailRow): StoredProgramDetail {
  return {
    program_version_id: row.program_version_id,
    title: row.title,
    notes: row.notes,
    weeks: row.weeks,
    days_per_week: row.days_per_week,
    sex_affinity: row.sex_affinity,
    goals: row.goals as StoredProgramDetail['goals'],
    levels: row.levels as StoredProgramDetail['levels'],
    emphases: row.emphases as StoredProgramDetail['emphases'],
    days: row.days,
    cover_object_key: row.cover_object_key,
  }
}

/** `postgres.js` hands a `date` back as a Date; the contract says a plain date. */
function date(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
}

function profile(row: ProfileRow): TrainingProfile {
  return {
    given_name: row.given_name,
    primary_training_goal: row.primary_training_goal as TrainingProfile['primary_training_goal'],
    training_experience: row.training_experience as TrainingProfile['training_experience'],
    biological_sex: row.biological_sex as TrainingProfile['biological_sex'],
    focus_areas: row.focus_areas as TrainingProfile['focus_areas'],
  }
}

/** A command carries no request id: it is not a read and writes no access record. */
function command<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return transact(sql, personId, '', operation)
}

/**
 * The projections always answer a row. A missing one is a function that changed
 * shape, not a case to handle, so it fails loudly rather than returning something
 * plausible.
 */
function answered<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`PostgreSQL did not ${what}`)
  return value
}

function transact<T>(
  sql: ReturnType<typeof database>,
  personId: string,
  requestId: string,
  operation: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return measureStudioRequestPhase('business-db', async () => {
    const result = await sql.begin(async (transaction) => {
      await transaction`
        select set_config('app.actor_kind', 'person', true),
               set_config('app.actor_person_id', ${personId}, true),
               set_config('app.request_id', ${requestId}, true)
      `
      return { value: await operation(transaction) }
    })
    return result.value
  })
}
