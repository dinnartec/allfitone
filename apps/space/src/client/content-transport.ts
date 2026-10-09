/**
 * The native half of making my own content: the stored session, the bearer header and
 * `expo-crypto`.
 *
 * Split from `content.ts` for the same reason the programme flow is split — that file
 * has to stay loadable by the test runner, and none of this does.
 *
 * **The catalogue walk lives here.** `OP-CAT-009` pages by cursor, and what Space wants
 * is the whole global subset: the picker filters in memory so its facet counts are
 * instant, and `HU-SP-064` wants the subset on the device for training without a
 * signal. So the transport walks the cursor once and hands up one list, and no screen
 * learns that pages exist.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost, authorizedPut } from './index'
import {
  createContentFlow,
  type ContentFlow,
  type CatalogueTerm,
  type Movement,
  type MovementDetail,
  type MovementPage,
  type MuscleTerm,
  type MyRoutine,
  type Program,
  type ProgramDraft,
  type ProgramVersion,
  type SessionTemplate,
  type SessionTemplateDraft,
  type SessionTemplateVersion,
} from './content'
import { authenticated } from './session'

/** The contract's ceiling. Fewer round trips for the same bytes. */
const PAGE_SIZE = 100

/** Ten thousand movements is not a catalogue, it is a runaway. */
const MAX_PAGES = 100

export function createSpaceContentFlow(): ContentFlow {
  return createContentFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      searchMovements: (discipline, query, muscles, equipment) =>
        authenticated(async (token) => {
          const filters =
            `/catalog/v1/movements?discipline=${encodeURIComponent(discipline)}&q=${encodeURIComponent(query)}` +
            `&limit=${PAGE_SIZE}` +
            // Repeated rather than joined: `muscle=a&muscle=b` is what the contract
            // declares, and a comma would arrive as one code nothing matches.
            muscles.map((code) => `&muscle=${encodeURIComponent(code)}`).join('') +
            equipment.map((code) => `&equipment=${encodeURIComponent(code)}`).join('')

          const all: Movement[] = []
          let cursor: string | null = null
          // Bounded: a server that always says there is more would otherwise spin here
          // forever, and a truncated catalogue is better than a frozen screen.
          for (let page = 0; page < MAX_PAGES; page += 1) {
            const found: MovementPage = await authorizedGet<MovementPage>(
              cursor === null ? filters : `${filters}&cursor=${encodeURIComponent(cursor)}`,
              token,
            )
            all.push(...found.data)
            if (!found.page.has_more || found.page.next_cursor === null) return all
            cursor = found.page.next_cursor
          }
          return all
        }),
      readEquipment: () =>
        authenticated((token) =>
          authorizedGet<readonly CatalogueTerm[]>('/catalog/v1/equipment', token),
        ),
      readMuscles: () =>
        authenticated((token) =>
          authorizedGet<readonly MuscleTerm[]>('/catalog/v1/muscles', token),
        ),
      readMovement: (movementId) =>
        authenticated((token) =>
          authorizedGet<MovementDetail>(
            `/catalog/v1/movements/${encodeURIComponent(movementId)}`,
            token,
          ),
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
      readTemplateDraft: (templateId) =>
        authenticated((token) =>
          authorizedGet<SessionTemplateDraft>(
            `/space/v1/session-templates/${templateId}/draft`,
            token,
          ),
        ),
      discardTemplate: (command, templateId) =>
        authenticated((token) =>
          authorizedPost<SessionTemplate>(
            `/space/v1/session-templates/${templateId}/discard`,
            command,
            undefined,
            token,
          ),
        ),
      readProgramDraft: (programId) =>
        authenticated((token) =>
          authorizedGet<ProgramDraft>(`/space/v1/programs/${programId}/draft`, token),
        ),
      readMyUnpublishedProgram: () =>
        authenticated((token) =>
          authorizedGet<Program | null>('/space/v1/programs/unpublished', token),
        ),
      discardProgram: (command, programId) =>
        authenticated((token) =>
          authorizedPost<Program>(
            `/space/v1/programs/${programId}/discard`,
            command,
            undefined,
            token,
          ),
        ),
      removeProgram: (command, programId, withRoutines) =>
        authenticated((token) =>
          authorizedPost<Program>(
            `/space/v1/programs/${programId}/remove`,
            command,
            { with_routines: withRoutines },
            token,
          ),
        ),
      duplicateProgram: (command, programId) =>
        authenticated((token) =>
          authorizedPost<Program>(
            `/space/v1/programs/${programId}/duplicate`,
            command,
            undefined,
            token,
          ),
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
