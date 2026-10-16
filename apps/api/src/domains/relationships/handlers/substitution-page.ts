/**
 * The page of covers, shaped for the contract.
 *
 * Shared by both surfaces because both answer the same page of the same rows:
 * who is asking changes which rows come back, and the row policy has already
 * decided that by the time this runs. Writing it twice would be two places for
 * a field to go missing from one of them.
 */

import type { SubstitutionPage } from '../domain/index.js'

/**
 * Unit separator. Chosen because no value in the cursor can contain it, so
 * splitting on it cannot be confused by an id or a timestamp.
 */
export const CURSOR_SEPARATOR = '\u001f'

export function presentSubstitutionPage(page: SubstitutionPage): Record<string, unknown> {
  const last = page.items.at(-1)
  return {
    data: page.items.map((cover) => ({
      assignment_id: cover.assignmentId,
      membership_id: cover.membershipId,
      professional_person_id: cover.professionalPersonId,
      display_name: cover.displayName,
      status: cover.status,
      valid_from: cover.validFrom.toISOString(),
      valid_to: cover.validTo?.toISOString() ?? null,
      ends_on: cover.endsOn,
      accepted_by_person_at: cover.acceptedByPersonAt?.toISOString() ?? null,
    })),
    page: {
      has_more: page.hasMore,
      next_cursor:
        page.hasMore && last
          ? Buffer.from(
              [last.validFrom.toISOString(), last.assignmentId].join(CURSOR_SEPARATOR),
              'utf8',
            ).toString('base64url')
          : null,
    },
  }
}

/**
 * Both halves or neither, and `null` for one that could not be read. Collapsing
 * «no cursor» and «broken cursor» would silently serve page one to somebody
 * paging forward, which reads as duplicated covers rather than as a bug.
 */
export function parseSubstitutionCursor(
  value: string | undefined,
  isUuid: (candidate: string) => boolean,
): { cursorValidFrom: string; cursorAssignmentId: string } | null | undefined {
  if (value === undefined) return undefined
  if (!/^[A-Za-z0-9_-]{8,1024}$/.test(value)) return null
  let parts: string[]
  try {
    parts = Buffer.from(value, 'base64url').toString('utf8').split(CURSOR_SEPARATOR)
  } catch {
    return null
  }
  if (parts.length !== 2) return null
  const [validFrom, assignmentId] = parts
  if (!validFrom || Number.isNaN(Date.parse(validFrom))) return null
  if (!assignmentId || !isUuid(assignmentId)) return null
  return { cursorValidFrom: validFrom, cursorAssignmentId: assignmentId }
}
