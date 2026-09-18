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
  ProgramVersion,
  SpacePlanningDatabase,
  TodaySession,
} from '../domain/space.js'

export type ProgramCatalogue = AllfitV1Schemas['SpaceProgramCatalogue']

/**
 * The two counts the Hoy screen draws under the programme's name. Named rather than
 * inlined because it is a projection of the week plan, not a row of anything.
 */
export interface WeekProgress {
  readonly sessions_planned: number
  readonly sessions_completed: number
}

export interface SpacePlanningService {
  createMySessionTemplate: SpacePlanningDatabase['createMySessionTemplate']
  replaceMySessionTemplateDraft: SpacePlanningDatabase['replaceMySessionTemplateDraft']
  publishMySessionTemplate: SpacePlanningDatabase['publishMySessionTemplate']
  readMySessionTemplateDraft: SpacePlanningDatabase['readMySessionTemplateDraft']
  discardMySessionTemplate: SpacePlanningDatabase['discardMySessionTemplate']
  discardMyProgram: SpacePlanningDatabase['discardMyProgram']
  readMyUnpublishedProgram: SpacePlanningDatabase['readMyUnpublishedProgram']
  createMyProgram: SpacePlanningDatabase['createMyProgram']
  replaceMyProgramDraft: SpacePlanningDatabase['replaceMyProgramDraft']
  publishMyProgram: SpacePlanningDatabase['publishMyProgram']
  readWeekPlan: SpacePlanningDatabase['readWeekPlan']
  readMyPrograms: SpacePlanningDatabase['readMyPrograms']
  readMyProgramDraft: SpacePlanningDatabase['readMyProgramDraft']
  publishAndRestate(
    input: Parameters<SpacePlanningDatabase['publishMyProgram']>[0] & { timezone: string },
  ): Promise<ProgramVersion>
  readMyContent: SpacePlanningDatabase['readMyContent']
  reorderMyPrograms: SpacePlanningDatabase['reorderMyPrograms']
  readCatalogue(input: { personId: string; requestId: string }): Promise<ProgramCatalogue>
  readWeekProgress(input: {
    personId: string
    timezone: string
    requestId: string
  }): Promise<WeekProgress>
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
    readWeekPlan: (input) => database.readWeekPlan(input),

    /**
     * How much of the selected programme's week is done.
     *
     * Planning answers this and not Execution, which is what the operations matrix
     * asks for: *«Planificación responde por lo que hay agendado esta semana,
     * Ejecución por lo entrenado»*. `execution.read_week_summary` was computing it by
     * reading `planning.planned_sessions` filtered by person and week only, so it
     * counted every programme somebody follows — the Hoy screen said `0 de 5` under
     * the title of a programme with one session a week.
     *
     * The week plan is already scoped to the assignment the tab opens on, so this is
     * counting what it returns. No programme at all is zero of zero, not an error:
     * the screen has a state for having nothing planned.
     */
    async readWeekProgress(input) {
      const plan = await database.readWeekPlan(input)
      if (!plan) return { sessions_planned: 0, sessions_completed: 0 }
      return {
        sessions_planned: plan.sessions.length,
        // `done` is whether a closed execution exists, which is not the same as the
        // planned session's own status — a session can be reopened and redone.
        sessions_completed: plan.sessions.filter((routine) => routine.done).length,
      }
    },
    readMyPrograms: (input) => database.readMyPrograms(input),
    readMySessionTemplateDraft: (input) => database.readMySessionTemplateDraft(input),
    discardMySessionTemplate: (input) => database.discardMySessionTemplate(input),
    discardMyProgram: (input) => database.discardMyProgram(input),
    readMyUnpublishedProgram: (input) => database.readMyUnpublishedProgram(input),
    readMyProgramDraft: (input) => database.readMyProgramDraft(input),

    /**
     * Publishing an edit and moving the agenda onto it are one act, not two.
     *
     * Left apart, editing a programme you are following would change nothing you
     * train until you took it again — and taking it again would leave a second
     * assignment that nothing can remove, and restart the week from today.
     *
     * **Which of the two happens is the server's decision, not the client's.** The
     * editor used to publish and then take the programme unconditionally, which was
     * right while publishing did nothing to the agenda; once the restate arrived it
     * meant an edit produced a duplicate assignment that started today with nothing
     * trained, went to the front of the order, and left the two tabs reading zero
     * while the sessions being trained counted on the other one. Only the restate
     * knows whether an agenda was there to move, so only it can say.
     */
    async publishAndRestate(input) {
      const version = await database.publishMyProgram(input)
      // The same key for all three, deliberately. Idempotency is unique per operation
      // code, so each receipt is its own — and reusing the key is what makes a
      // retried publish restate, or take, exactly once.
      const restated = await database.restateMyProgramAssignment({
        personId: input.personId,
        programVersionId: version.id,
        idempotencyKey: input.idempotencyKey,
        commandId: input.commandId,
        requestHash: input.requestHash,
      })
      if (restated === null) {
        // Publishing it is not having it: the catalogue reads global content and the
        // selector reads assignments, so a programme just written would be invisible.
        await database.selfAssignProgram({
          personId: input.personId,
          programVersionId: version.id,
          timezone: input.timezone,
          idempotencyKey: input.idempotencyKey,
          commandId: input.commandId,
          requestHash: input.requestHash,
        })
      }
      return version
    },
    readMyContent: (input) => database.readMyContent(input),
    reorderMyPrograms: (input) => database.reorderMyPrograms(input),
    createMySessionTemplate: (input) => database.createMySessionTemplate(input),
    replaceMySessionTemplateDraft: (input) => database.replaceMySessionTemplateDraft(input),
    publishMySessionTemplate: (input) => database.publishMySessionTemplate(input),
    createMyProgram: (input) => database.createMyProgram(input),
    replaceMyProgramDraft: (input) => database.replaceMyProgramDraft(input),
    publishMyProgram: (input) => database.publishMyProgram(input),

    readProgram: (input) => database.readProgramVersion(input),

    chooseProgram: (input) => database.selfAssignProgram(input),
  }
}
