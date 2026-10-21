/**
 * The relationship history as both surfaces answer it. Shared because Studio and Space
 * read the same timeline and must say it the same way.
 */

import type { RelationshipHistory } from '../domain/index.js'

/*
 * `{ data, page }`, like every other paginated response here. The relationship's
 * own id is in the path the caller used, so repeating it in the body would be a
 * second source for the same fact.
 */
export function presentHistory(history: RelationshipHistory): Record<string, unknown> {
  return {
    data: history.events.map((event) => ({
      type: event.type,
      occurred_at: event.occurredAt.toISOString(),
      source_id: event.sourceId,
      detail: event.detail,
    })),
    page: {
      next_cursor: history.nextCursor,
      has_more: history.hasMore,
    },
  }
}
