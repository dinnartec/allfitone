/**
 * Free training (`HU-SP-052`, `LIB-1..3`): what Today and the session say about a session
 * with no routine behind it.
 *
 * A free session is the only one without a title — a planned session always carries its
 * routine's — so the title's absence is what names it. Only one is open at a time, and
 * Today learns which from `open_free_session_id`: the same bar that brings back a
 * minimised routine brings it back, and the offer says it is waiting instead of
 * promising to start another.
 */

export const FREE_SESSION_TITLE = 'Entreno libre'

const OFFER = 'Sin programa, registras sobre la marcha'
const WAITING = 'Tienes uno en curso: tócalo para volver'
const NO_ROUTINE = 'Sin rutina asignada'

/** The line under «Entrenamiento libre» on Today. */
export const freeOfferCaption = (openFreeSessionId: string | null): string =>
  openFreeSessionId ? WAITING : OFFER

export interface OpenSession {
  readonly executionId: string
  readonly title: string
}

/** What the «En curso» bar brings back: the routine first, as it did, then the free one. */
export function openSessionBar(
  planned: OpenSession | undefined,
  openFreeSessionId: string | null,
): OpenSession | undefined {
  if (planned) return planned
  return openFreeSessionId
    ? { executionId: openFreeSessionId, title: FREE_SESSION_TITLE }
    : undefined
}

/** The session's name and the line under it, which for an empty free one says why. */
export function sessionHeading(
  title: string | null,
  muscles: string,
): { title: string; line: string } {
  if (title !== null) return { title, line: muscles }
  return { title: FREE_SESSION_TITLE, line: muscles || NO_ROUTINE }
}
