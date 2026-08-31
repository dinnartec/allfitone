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
  ProgramAssignment,
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
