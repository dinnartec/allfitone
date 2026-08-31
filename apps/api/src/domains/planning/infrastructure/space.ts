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
  MyProgram,
  WeekPlan,
  ProgramAssignment,
  ProgramDetail,
  ProgramSummary,
  SpacePlanningDatabase,
  TrainingProfile,
} from '../domain/space.js'

interface CatalogueRow {
  program_version_id: string
  program_id: string
  title: string
  weeks: number
  days_per_week: number
  sex_affinity: 'male' | 'female' | null
  goals: string[]
  levels: string[]
  emphases: string[]
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
  weeks: number
  days_per_week: number
  sex_affinity: 'male' | 'female' | null
  goals: string[]
  levels: string[]
  emphases: string[]
  days: ProgramDetail['days']
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

interface MyProgramRow extends Omit<MyProgram, 'starts_on'> {
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

function summary(row: CatalogueRow): ProgramSummary {
  return {
    program_version_id: row.program_version_id,
    program_id: row.program_id,
    title: row.title,
    weeks: row.weeks,
    days_per_week: row.days_per_week,
    sex_affinity: row.sex_affinity,
    goals: row.goals as ProgramSummary['goals'],
    levels: row.levels as ProgramSummary['levels'],
    emphases: row.emphases as ProgramSummary['emphases'],
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

function detail(row: DetailRow): ProgramDetail {
  return {
    program_version_id: row.program_version_id,
    title: row.title,
    notes: row.notes,
    weeks: row.weeks,
    days_per_week: row.days_per_week,
    sex_affinity: row.sex_affinity,
    goals: row.goals as ProgramDetail['goals'],
    levels: row.levels as ProgramDetail['levels'],
    emphases: row.emphases as ProgramDetail['emphases'],
    days: row.days,
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
