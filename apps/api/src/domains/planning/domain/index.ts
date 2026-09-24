import type { AllfitV1Schemas } from '@allfitone/contracts'

export type SessionTemplate = AllfitV1Schemas['SessionTemplate']
export type SessionTemplateDraft = AllfitV1Schemas['SessionTemplateDraft']
export type SessionTemplateDraftContent = AllfitV1Schemas['SessionTemplateDraftContent']
export type SessionTemplateVersion = AllfitV1Schemas['SessionTemplateVersion']
export type Program = AllfitV1Schemas['Program']
export type ProgramDraft = AllfitV1Schemas['ProgramDraft']
export type ProgramDraftContent = AllfitV1Schemas['ProgramDraftContent']
export type ProgramVersion = AllfitV1Schemas['ProgramVersion']

export interface PlanningCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Buffer
}

export interface PlanningCommandResult<T> {
  resource: T
  replayed: boolean
}

export interface PlanningPage<T> {
  items: T[]
  hasMore: boolean
  nextCursor?: { updatedAt: string; id: string }
}

export interface PlanningDatabase {
  createSessionTemplate(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      disciplineCode: string
      title: string
    },
  ): Promise<PlanningCommandResult<SessionTemplate>>
  replaceSessionTemplateDraft(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      templateId: string
      expectedEtag: string
      content: SessionTemplateDraftContent
    },
  ): Promise<PlanningCommandResult<SessionTemplateDraft>>
  publishSessionTemplateVersion(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      templateId: string
      expectedEtag: string
    },
  ): Promise<PlanningCommandResult<SessionTemplateVersion>>
  deriveSessionTemplateVersion(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      templateId: string
      versionNumber: number
      expectedEtag: string
    },
  ): Promise<PlanningCommandResult<SessionTemplateDraft>>
  deprecateSessionTemplateVersion(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      templateId: string
      versionNumber: number
    },
  ): Promise<PlanningCommandResult<SessionTemplateVersion>>
  createProgram(
    input: PlanningCommand & { personId: string; organizationId: string; title: string },
  ): Promise<PlanningCommandResult<Program>>
  replaceProgramDraft(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      programId: string
      expectedEtag: string
      content: ProgramDraftContent
    },
  ): Promise<PlanningCommandResult<ProgramDraft>>
  publishProgramVersion(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      programId: string
      expectedEtag: string
    },
  ): Promise<PlanningCommandResult<ProgramVersion>>
  deprecateProgramVersion(
    input: PlanningCommand & {
      personId: string
      organizationId: string
      programId: string
      versionNumber: number
    },
  ): Promise<PlanningCommandResult<ProgramVersion>>
  listSessionTemplates(input: {
    personId: string
    organizationId: string
    requestId: string
    limit: number
    cursor?: { updatedAt: string; id: string }
  }): Promise<PlanningPage<SessionTemplate>>
  listPrograms(input: {
    personId: string
    organizationId: string
    requestId: string
    limit: number
    cursor?: { updatedAt: string; id: string }
  }): Promise<PlanningPage<Program>>
  /** Null when the draft is outside the caller's organization, discarded, or gone. */
  readSessionTemplateDraft(input: {
    personId: string
    organizationId: string
    templateId: string
    requestId: string
  }): Promise<SessionTemplateDraft | null>
  readSessionTemplateVersion(input: {
    personId: string
    organizationId: string
    templateId: string
    versionNumber: number
    requestId: string
  }): Promise<SessionTemplateVersion>
}
