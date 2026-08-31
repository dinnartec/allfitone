/**
 * The Space side of planning: reading the catalogue Allfit publishes, and choosing
 * from it.
 *
 * Separate from `domain/index.ts` because it shares nothing with Studio's content
 * authoring. Studio composes and publishes; Space reads what was published and picks.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ProgramSummary = AllfitV1Schemas['SpaceProgramSummary']
export type ProgramAssignment = AllfitV1Schemas['SpaceProgramAssignment']
export type TrainingProfile = AllfitV1Schemas['SpaceTrainingProfile']
export type ProgramDetail = AllfitV1Schemas['SpaceProgramDetail']
export type TodaySession = AllfitV1Schemas['SpaceTodaySession']
export type WeekPlan = AllfitV1Schemas['SpaceWeekPlan']
export type MyProgram = AllfitV1Schemas['SpaceMyProgram']
export type ProgramOrder = AllfitV1Schemas['SpaceProgramOrder']

export interface SpacePlanningDatabase {
  readProgramCatalogue(input: { personId: string; requestId: string }): Promise<ProgramSummary[]>
  readCurrentAssignment(input: {
    personId: string
    requestId: string
  }): Promise<ProgramAssignment | null>
  readTrainingProfile(input: { personId: string; requestId: string }): Promise<TrainingProfile>
  /** Null when the version does not exist or is not this person's to read. */
  readProgramVersion(input: {
    personId: string
    programVersionId: string
    requestId: string
  }): Promise<ProgramDetail | null>
  /** Null on a day the program does not ask for anything. A rest day is an answer. */
  readTodaySession(input: {
    personId: string
    timezone: string
    requestId: string
  }): Promise<TodaySession | null>
  /** Null when the person has no programme: an object full of nulls is not an answer. */
  readWeekPlan(input: {
    personId: string
    timezone: string
    requestId: string
  }): Promise<WeekPlan | null>
  readMyPrograms(input: { personId: string; requestId: string }): Promise<readonly MyProgram[]>
  reorderMyPrograms(input: {
    personId: string
    assignmentIds: readonly string[]
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<readonly MyProgram[]>
  selfAssignProgram(input: {
    personId: string
    programVersionId: string
    timezone: string
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<ProgramAssignment>
}
