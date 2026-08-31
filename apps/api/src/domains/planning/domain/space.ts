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

export interface SpacePlanningDatabase {
  readProgramCatalogue(input: { personId: string; requestId: string }): Promise<ProgramSummary[]>
  readCurrentAssignment(input: {
    personId: string
    requestId: string
  }): Promise<ProgramAssignment | null>
  readTrainingProfile(input: { personId: string; requestId: string }): Promise<TrainingProfile>
  selfAssignProgram(input: {
    personId: string
    programVersionId: string
    timezone: string
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<ProgramAssignment>
}
