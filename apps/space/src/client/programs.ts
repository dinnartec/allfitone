/**
 * Choosing a program: the decisions, kept loadable by the test runner.
 *
 * Same split as the onboarding: the flow holds what must be true, the transport holds
 * the fetch and the stored session. What has to be true here is one thing, and it is
 * the same thing activation needed — **the key is held across retries and never
 * renewed**. A second key would be a second command, and choosing twice would leave
 * somebody with two calendars from one press.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

export type ProgramCatalogue = AllfitV1Schemas['SpaceProgramCatalogue']
export type ProgramAssignment = AllfitV1Schemas['SpaceProgramAssignment']
export type ProgramChoice = AllfitV1Schemas['SpaceProgramChoice']
export type ProgramDetail = AllfitV1Schemas['SpaceProgramDetail']
export type ProgramDay = AllfitV1Schemas['SpaceProgramDay']
export type ProgramStep = AllfitV1Schemas['SpaceProgramStep']
export type WeekPlan = AllfitV1Schemas['SpaceWeekPlan']
export type WeekRoutine = AllfitV1Schemas['SpaceWeekRoutine']
export type MyProgram = AllfitV1Schemas['SpaceMyProgram']
export type ProgramCover = AllfitV1Schemas['SpaceProgramCover']
type RoutineCover = AllfitV1Schemas['RoutineCover']

export interface ProgramTransport {
  readWeekPlan(timezone: string): Promise<WeekPlan>
  readMyPrograms(): Promise<readonly MyProgram[]>
  reorder(command: CommandHeaders, assignmentIds: readonly string[]): Promise<readonly MyProgram[]>
  setCover(
    command: CommandHeaders,
    programId: string,
    cover: RoutineCover | null,
  ): Promise<ProgramCover>
  readCatalogue(): Promise<ProgramCatalogue>
  readDetail(programVersionId: string): Promise<ProgramDetail>
  choose(command: CommandHeaders, choice: ProgramChoice): Promise<ProgramAssignment>
}

export interface ProgramFlowDependencies {
  transport: ProgramTransport
  newCommand: () => CommandHeaders
}

export interface ProgramFlow {
  readWeekPlan(timezone: string): Promise<WeekPlan>
  readMyPrograms(): Promise<readonly MyProgram[]>
  reorder(assignmentIds: readonly string[]): Promise<readonly MyProgram[]>
  /** Cómo se ven las rutinas de este programa. Surte efecto al momento; no publica. */
  setCover(programId: string, cover: RoutineCover | null): Promise<ProgramCover>
  readCatalogue(): Promise<ProgramCatalogue>
  readDetail(programVersionId: string): Promise<ProgramDetail>
  choose(choice: ProgramChoice): Promise<ProgramAssignment>
}

export function createProgramFlow(dependencies: ProgramFlowDependencies): ProgramFlow {
  // Per program version: pressing one card and then another is two intentions and
  // must not share a key, while pressing the same card twice is one.
  const pending = new Map<string, CommandHeaders>()

  return {
    readWeekPlan: (timezone) => dependencies.transport.readWeekPlan(timezone),
    readMyPrograms: () => dependencies.transport.readMyPrograms(),
    // A new command every time: it is the order as it now stands, not a retry of
    // the previous one.
    reorder: (assignmentIds) =>
      dependencies.transport.reorder(dependencies.newCommand(), assignmentIds),

    setCover: (programId, cover) =>
      dependencies.transport.setCover(dependencies.newCommand(), programId, cover),
    readCatalogue: () => dependencies.transport.readCatalogue(),

    readDetail: (programVersionId) => dependencies.transport.readDetail(programVersionId),

    async choose(choice) {
      let command = pending.get(choice.program_version_id)
      if (!command) {
        command = dependencies.newCommand()
        pending.set(choice.program_version_id, command)
      }
      const assignment = await dependencies.transport.choose(command, choice)
      pending.delete(choice.program_version_id)
      return assignment
    },
  }
}
