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

export interface ProgramTransport {
  readCatalogue(): Promise<ProgramCatalogue>
  choose(command: CommandHeaders, choice: ProgramChoice): Promise<ProgramAssignment>
}

export interface ProgramFlowDependencies {
  transport: ProgramTransport
  newCommand: () => CommandHeaders
}

export interface ProgramFlow {
  readCatalogue(): Promise<ProgramCatalogue>
  choose(choice: ProgramChoice): Promise<ProgramAssignment>
}

export function createProgramFlow(dependencies: ProgramFlowDependencies): ProgramFlow {
  // Per program version: pressing one card and then another is two intentions and
  // must not share a key, while pressing the same card twice is one.
  const pending = new Map<string, CommandHeaders>()

  return {
    readCatalogue: () => dependencies.transport.readCatalogue(),

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
