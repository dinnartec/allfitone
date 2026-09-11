/**
 * The native half of making my own content: the stored session, the bearer header and
 * `expo-crypto`.
 *
 * Split from `content.ts` for the same reason the programme flow is split — that file
 * has to stay loadable by the test runner, and none of this does.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { ApiError, authorizedGet, authorizedPost, authorizedPut, refreshSession } from './index'
import {
  createContentFlow,
  type ContentFlow,
  type CatalogueTerm,
  type Movement,
  type MuscleTerm,
  type MyRoutine,
  type Program,
  type ProgramDraft,
  type ProgramVersion,
  type SessionTemplate,
  type SessionTemplateDraft,
  type SessionTemplateVersion,
} from './content'
import { readSession, storeSession } from './session'
import { withRefresh } from './with-refresh'

export function createSpaceContentFlow(): ContentFlow {
  return createContentFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      searchMovements: (discipline, query, muscles, equipment) =>
        authenticated((token) =>
          authorizedGet<readonly Movement[]>(
            `/catalog/v1/movements?discipline=${encodeURIComponent(discipline)}&q=${encodeURIComponent(query)}` +
              // Repeated rather than joined: `muscle=a&muscle=b` is what the contract
              // declares, and a comma would arrive as one code nothing matches.
              muscles.map((code) => `&muscle=${encodeURIComponent(code)}`).join('') +
              equipment.map((code) => `&equipment=${encodeURIComponent(code)}`).join(''),
            token,
          ),
        ),
      readEquipment: () =>
        authenticated((token) =>
          authorizedGet<readonly CatalogueTerm[]>('/catalog/v1/equipment', token),
        ),
      readMuscles: () =>
        authenticated((token) =>
          authorizedGet<readonly MuscleTerm[]>('/catalog/v1/muscles', token),
        ),
      readMyRoutines: () =>
        authenticated((token) =>
          authorizedGet<readonly MyRoutine[]>('/space/v1/my-content', token),
        ),
      createTemplate: (command, disciplineCode, title) =>
        authenticated((token) =>
          authorizedPost<SessionTemplate>(
            '/space/v1/session-templates',
            command,
            { discipline_code: disciplineCode, title },
            token,
          ),
        ),
      saveTemplateDraft: (command, templateId, etag, content) =>
        authenticated((token) =>
          authorizedPut<SessionTemplateDraft>(
            `/space/v1/session-templates/${templateId}/draft`,
            command,
            content,
            token,
            etag,
          ),
        ),
      publishTemplate: (command, templateId, etag) =>
        authenticated((token) =>
          authorizedPost<SessionTemplateVersion>(
            `/space/v1/session-templates/${templateId}/versions`,
            command,
            undefined,
            token,
            etag,
          ),
        ),
      readProgramDraft: (programId) =>
        authenticated((token) =>
          authorizedGet<ProgramDraft>(`/space/v1/programs/${programId}/draft`, token),
        ),
      createProgram: (command, title) =>
        authenticated((token) =>
          authorizedPost<Program>('/space/v1/programs', command, { title }, token),
        ),
      saveProgramDraft: (command, programId, etag, content) =>
        authenticated((token) =>
          authorizedPut<ProgramDraft>(
            `/space/v1/programs/${programId}/draft`,
            command,
            content,
            token,
            etag,
          ),
        ),
      publishProgram: (command, programId, etag, timezone) =>
        authenticated((token) =>
          authorizedPost<ProgramVersion>(
            `/space/v1/programs/${programId}/versions?timezone=${encodeURIComponent(timezone)}`,
            command,
            undefined,
            token,
            etag,
          ),
        ),
    },
  })
}

function authenticated<T>(send: (token: string | undefined) => Promise<T>): Promise<T> {
  return withRefresh(
    {
      session: async () => {
        const stored = await readSession()
        if (!stored) return null
        return { accessToken: stored.accessToken, refreshToken: stored.refreshToken }
      },
      persist: (tokens) => storeSession({ ...tokens, analytics: { distinct_id: null } }),
      refresh: async (refreshToken) => {
        const rotated = await refreshSession(refreshToken)
        return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken }
      },
      unauthorized: (error) => error instanceof ApiError && error.failure === 'unauthenticated',
    },
    send,
  )
}
