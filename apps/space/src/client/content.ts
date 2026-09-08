/**
 * Making a routine and a programme of my own: the decisions, kept loadable by the
 * test runner.
 *
 * Two things here are not obvious from a screenshot and are the reason this file
 * exists apart from the screens.
 *
 * **The etag is a conversation, not a value.** Every save answers with the draft's new
 * etag, and the next save must carry it. The flow holds the latest one so a screen
 * never has to, because a screen that forgets it turns a save into a `409`.
 *
 * **A base week is not what the server stores.** `PR-1` draws seven days and a number
 * of weeks; a programme version stores one entry per session with its own week, day
 * and position. Expanding one into the other is arithmetic, and arithmetic in a screen
 * is arithmetic nobody tests — so it lives in `expandBaseWeek` with its own cases.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

export type Movement = AllfitV1Schemas['Movement']
export type MyRoutine = AllfitV1Schemas['SpaceMyRoutine']
export type SessionTemplate = AllfitV1Schemas['SessionTemplate']
export type SessionTemplateDraft = AllfitV1Schemas['SessionTemplateDraft']
export type SessionTemplateDraftContent = AllfitV1Schemas['SessionTemplateDraftContent']
export type SessionTemplateVersion = AllfitV1Schemas['SessionTemplateVersion']
export type Program = AllfitV1Schemas['Program']
export type ProgramDraft = AllfitV1Schemas['ProgramDraft']
export type ProgramDraftContent = AllfitV1Schemas['ProgramDraftContent']
export type ProgramVersion = AllfitV1Schemas['ProgramVersion']

/** One day of `PR-1`'s base week: a weekday, and the routine on it or nothing. */
export interface BaseWeekDay {
  readonly day: number
  readonly templateVersionId: string | null
}

export interface ContentTransport {
  searchMovements(discipline: string, query: string): Promise<readonly Movement[]>
  readMyRoutines(): Promise<readonly MyRoutine[]>
  createTemplate(
    command: CommandHeaders,
    disciplineCode: string,
    title: string,
  ): Promise<SessionTemplate>
  saveTemplateDraft(
    command: CommandHeaders,
    templateId: string,
    etag: string,
    content: SessionTemplateDraftContent,
  ): Promise<SessionTemplateDraft>
  publishTemplate(
    command: CommandHeaders,
    templateId: string,
    etag: string,
  ): Promise<SessionTemplateVersion>
  createProgram(command: CommandHeaders, title: string): Promise<Program>
  saveProgramDraft(
    command: CommandHeaders,
    programId: string,
    etag: string,
    content: ProgramDraftContent,
  ): Promise<ProgramDraft>
  publishProgram(command: CommandHeaders, programId: string, etag: string): Promise<ProgramVersion>
}

export interface ContentFlowDependencies {
  transport: ContentTransport
  newCommand: () => CommandHeaders
}

export interface ContentFlow {
  searchMovements(discipline: string, query: string): Promise<readonly Movement[]>
  readMyRoutines(): Promise<readonly MyRoutine[]>
  createTemplate(disciplineCode: string, title: string): Promise<SessionTemplate>
  saveTemplateDraft(
    templateId: string,
    content: SessionTemplateDraftContent,
  ): Promise<SessionTemplateDraft>
  publishTemplate(templateId: string): Promise<SessionTemplateVersion>
  createProgram(title: string): Promise<Program>
  saveProgramDraft(programId: string, content: ProgramDraftContent): Promise<ProgramDraft>
  publishProgram(programId: string): Promise<ProgramVersion>
  /** What the flow will send as `If-Match`, for a screen that needs to say so. */
  etagFor(id: string): string | undefined
  remember(id: string, etag: string): void
}

export class MissingEtagError extends Error {
  constructor(readonly id: string) {
    super('missing-etag')
    this.name = 'MissingEtagError'
  }
}

export function createContentFlow(dependencies: ContentFlowDependencies): ContentFlow {
  const etags = new Map<string, string>()
  // Per aggregate: creating a routine and then a programme are two intentions, while
  // a retried creation of the same thing is one.
  const creating = new Map<string, CommandHeaders>()

  const etagOf = (id: string) => {
    const etag = etags.get(id)
    if (!etag) throw new MissingEtagError(id)
    return etag
  }

  const once = (key: string) => {
    let command = creating.get(key)
    if (!command) {
      command = dependencies.newCommand()
      creating.set(key, command)
    }
    return command
  }

  return {
    searchMovements: (discipline, query) =>
      dependencies.transport.searchMovements(discipline, query),
    readMyRoutines: () => dependencies.transport.readMyRoutines(),

    etagFor: (id) => etags.get(id),
    remember: (id, etag) => {
      etags.set(id, etag)
    },

    async createTemplate(disciplineCode, title) {
      const key = `template:${disciplineCode}:${title}`
      const template = await dependencies.transport.createTemplate(once(key), disciplineCode, title)
      creating.delete(key)
      if (template.draft) etags.set(template.id, template.draft.etag)
      return template
    },

    // A new command every time: this is the draft as it now stands, not a retry.
    async saveTemplateDraft(templateId, content) {
      const draft = await dependencies.transport.saveTemplateDraft(
        dependencies.newCommand(),
        templateId,
        etagOf(templateId),
        content,
      )
      etags.set(templateId, draft.etag)
      return draft
    },

    async publishTemplate(templateId) {
      const key = `publish-template:${templateId}:${etagOf(templateId)}`
      const version = await dependencies.transport.publishTemplate(
        once(key),
        templateId,
        etagOf(templateId),
      )
      creating.delete(key)
      return version
    },

    async createProgram(title) {
      const key = `program:${title}`
      const program = await dependencies.transport.createProgram(once(key), title)
      creating.delete(key)
      if (program.draft) etags.set(program.id, program.draft.etag)
      return program
    },

    async saveProgramDraft(programId, content) {
      const draft = await dependencies.transport.saveProgramDraft(
        dependencies.newCommand(),
        programId,
        etagOf(programId),
        content,
      )
      etags.set(programId, draft.etag)
      return draft
    },

    async publishProgram(programId) {
      const key = `publish-program:${programId}:${etagOf(programId)}`
      const version = await dependencies.transport.publishProgram(
        once(key),
        programId,
        etagOf(programId),
      )
      creating.delete(key)
      return version
    },
  }
}

/**
 * `PR-1`'s base week, repeated, as the sessions a programme version stores.
 *
 * Position is continuous across the whole programme and not restarted each week: it is
 * what orders the calendar, and `read_week_plan` reads the week from `week`.
 */
export function expandBaseWeek(
  baseWeek: readonly BaseWeekDay[],
  weeks: number,
): ProgramDraftContent['sessions'] {
  const filled = [...baseWeek]
    .filter(
      (day): day is BaseWeekDay & { templateVersionId: string } => day.templateVersionId !== null,
    )
    .sort((one, other) => one.day - other.day)

  const sessions: ProgramDraftContent['sessions'] = []
  let position = 1
  for (let week = 1; week <= weeks; week += 1) {
    for (const day of filled) {
      sessions.push({
        position,
        week,
        day: day.day,
        template_version_id: day.templateVersionId,
      })
      position += 1
    }
  }
  return sessions
}

/** What `PR-1` shows under the week: how much of it there actually is. */
export function summarizeBaseWeek(
  baseWeek: readonly BaseWeekDay[],
  weeks: number,
): { daysPerWeek: number; sessions: number } {
  const daysPerWeek = baseWeek.filter((day) => day.templateVersionId !== null).length
  return { daysPerWeek, sessions: daysPerWeek * weeks }
}
