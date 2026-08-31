/**
 * The Space planning use cases: read the catalogue, and choose from it.
 *
 * The catalogue read composes three answers into one — the programs Allfit publishes,
 * what the person declared, and whether they already chose. One round trip, because
 * the screen cannot render any of it without all three: without the profile it cannot
 * match, and without the assignment it cannot know whether to ask at all.
 *
 * The matching itself is **not** here. It lives in the app, where every combination
 * of goal, level and frequency can be asserted in a test rather than judged from a
 * screenshot, and where the copy that explains a choice sits beside the rule that
 * made it.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type {
  ProgramAssignment,
  ProgramDetail,
  SpacePlanningDatabase,
  TodaySession,
} from '../domain/space.js'

export type ProgramCatalogue = AllfitV1Schemas['SpaceProgramCatalogue']

export interface SpacePlanningService {
  readCatalogue(input: { personId: string; requestId: string }): Promise<ProgramCatalogue>
  readTodaySession(input: {
    personId: string
    timezone: string
    requestId: string
  }): Promise<TodaySession | null>
  readProgram(input: {
    personId: string
    programVersionId: string
    requestId: string
  }): Promise<ProgramDetail | null>
  chooseProgram(input: {
    personId: string
    programVersionId: string
    timezone: string
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<ProgramAssignment>
}

export function createSpacePlanningService(database: SpacePlanningDatabase): SpacePlanningService {
  return {
    async readCatalogue({ personId, requestId }) {
      const [profile, programs, currentAssignment] = await Promise.all([
        database.readTrainingProfile({ personId, requestId }),
        database.readProgramCatalogue({ personId, requestId }),
        database.readCurrentAssignment({ personId, requestId }),
      ])
      return { profile, programs, current_assignment: currentAssignment }
    },

    readTodaySession: (input) => database.readTodaySession(input),

    readProgram: (input) => database.readProgramVersion(input),

    chooseProgram: (input) => database.selfAssignProgram(input),
  }
}
