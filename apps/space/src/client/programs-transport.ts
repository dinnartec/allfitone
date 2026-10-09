/**
 * The native half of the program flow: the stored session, the bearer header and
 * `expo-crypto`.
 *
 * Split from `programs.ts` for the same reason the onboarding is split — that file
 * has to stay loadable by the test runner, and none of this does.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost, authorizedPut } from './index'
import {
  type MyProgram,
  type WeekPlan,
  createProgramFlow,
  type ProgramAssignment,
  type ProgramCatalogue,
  type ProgramCover,
  type ProgramDetail,
  type ProgramFlow,
} from './programs'
import { authenticated } from './session'

export function createSpaceProgramFlow(): ProgramFlow {
  return createProgramFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      readWeekPlan: (timezone) =>
        authenticated((token) =>
          authorizedGet<WeekPlan>(
            `/space/v1/week-plan?timezone=${encodeURIComponent(timezone)}`,
            token,
          ),
        ),
      readMyPrograms: () =>
        authenticated((token) =>
          authorizedGet<readonly MyProgram[]>('/space/v1/programs/mine', token),
        ),
      reorder: (command, assignmentIds) =>
        authenticated((token) =>
          authorizedPut<readonly MyProgram[]>(
            '/space/v1/programs/mine/order',
            command,
            { assignment_ids: assignmentIds },
            token,
          ),
        ),
      setCover: (command, programId, cover) =>
        authenticated((token) =>
          authorizedPut<ProgramCover>(
            `/space/v1/programs/${programId}/cover`,
            command,
            { cover },
            token,
          ),
        ),
      readCatalogue: () =>
        authenticated((token) => authorizedGet<ProgramCatalogue>('/space/v1/programs', token)),
      readDetail: (programVersionId) =>
        authenticated((token) =>
          authorizedGet<ProgramDetail>(`/space/v1/programs/${programVersionId}`, token),
        ),
      choose: (command, choice) =>
        authenticated((token) =>
          authorizedPost<ProgramAssignment>('/space/v1/assignments', command, choice, token),
        ),
    },
  })
}
