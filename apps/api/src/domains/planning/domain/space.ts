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
export type MyRoutine = AllfitV1Schemas['SpaceMyRoutine']
export type ProgramOrder = AllfitV1Schemas['SpaceProgramOrder']

/**
 * The content shapes are Studio's, deliberately. A routine is a routine whoever owns
 * it, and a second definition would let the same content hash to two things.
 */
export type SessionTemplate = AllfitV1Schemas['SessionTemplate']
export type SessionTemplateDraft = AllfitV1Schemas['SessionTemplateDraft']
export type SessionTemplateDraftContent = AllfitV1Schemas['SessionTemplateDraftContent']
export type SessionTemplateVersion = AllfitV1Schemas['SessionTemplateVersion']
export type Program = AllfitV1Schemas['Program']
export type ProgramDraft = AllfitV1Schemas['ProgramDraft']
export type ProgramDraftContent = AllfitV1Schemas['ProgramDraftContent']
export type ProgramVersion = AllfitV1Schemas['ProgramVersion']

export interface OwnContentCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Buffer
}

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
  readMyContent(input: { personId: string; requestId: string }): Promise<readonly MyRoutine[]>
  reorderMyPrograms(input: {
    personId: string
    assignmentIds: readonly string[]
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<readonly MyProgram[]>
  createMySessionTemplate(
    input: OwnContentCommand & { personId: string; disciplineCode: string; title: string },
  ): Promise<SessionTemplate>
  replaceMySessionTemplateDraft(
    input: OwnContentCommand & {
      personId: string
      templateId: string
      expectedEtag: string
      content: SessionTemplateDraftContent
    },
  ): Promise<SessionTemplateDraft>
  publishMySessionTemplate(
    input: OwnContentCommand & { personId: string; templateId: string; expectedEtag: string },
  ): Promise<SessionTemplateVersion>
  createMyProgram(input: OwnContentCommand & { personId: string; title: string }): Promise<Program>
  replaceMyProgramDraft(
    input: OwnContentCommand & {
      personId: string
      programId: string
      expectedEtag: string
      content: ProgramDraftContent
    },
  ): Promise<ProgramDraft>
  publishMyProgram(
    input: OwnContentCommand & { personId: string; programId: string; expectedEtag: string },
  ): Promise<ProgramVersion>
  /** Null when the routine is somebody else's, discarded, or never existed. */
  readMySessionTemplateDraft(input: {
    personId: string
    templateId: string
    requestId: string
  }): Promise<SessionTemplateDraft | null>
  /** Archived rather than deleted; refused when a version was ever published. */
  discardMySessionTemplate(
    input: OwnContentCommand & { personId: string; templateId: string },
  ): Promise<SessionTemplate>
  /** The programme somebody started and never published, or null. */
  readMyUnpublishedProgram(input: { personId: string; requestId: string }): Promise<Program | null>
  /** Archived rather than deleted; refused when a version was ever published. */
  discardMyProgram(
    input: OwnContentCommand & { personId: string; programId: string },
  ): Promise<Program>
  /** Null when the programme is somebody else's, or was taken rather than written. */
  readMyProgramDraft(input: {
    personId: string
    programId: string
    requestId: string
  }): Promise<ProgramDraft | null>
  /** The assignment moved onto the version, or null when the programme is not followed. */
  restateMyProgramAssignment(input: {
    personId: string
    programVersionId: string
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<string | null>
  selfAssignProgram(input: {
    personId: string
    programVersionId: string
    timezone: string
    idempotencyKey: string
    commandId: string
    requestHash: Buffer
  }): Promise<ProgramAssignment>
}
