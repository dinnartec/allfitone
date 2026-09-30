/**
 * What the client directory screen needs to know before it asks for anything.
 *
 * Permission is read from the role catalog the server publishes rather than
 * from a list of role codes written here. PostgreSQL opens the directory
 * through two capabilities, and a copy of that mapping in the client is a
 * second source of truth that drifts silently the day the grant changes.
 *
 * The two capabilities are not two levels of the same permission. Holding
 * `view_directory` shows every client and every unanswered invitation of the
 * organization; holding only `view_assigned_directory` shows the clients that
 * person was assigned and the invitations they sent. Both are a real
 * directory, so both open the screen — the narrowing happens in the database,
 * never here.
 */
import type { ClientDirectoryItem, OrganizationRole } from './studio-api'

const VIEW_DIRECTORY = 'view_directory'
const VIEW_ASSIGNED_DIRECTORY = 'view_assigned_directory'

export function canViewClientDirectory(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some(
        (capability) =>
          capability.code === VIEW_DIRECTORY || capability.code === VIEW_ASSIGNED_DIRECTORY,
      ),
  )
}

/**
 * True when the caller sees the whole organization rather than their own
 * assignments. Used only to word the screen honestly — a coach is told the list
 * is theirs, not the organization's, so an incomplete list does not read as
 * missing clients.
 */
export function seesEveryClient(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === VIEW_DIRECTORY),
  )
}

/** The id an entry is keyed and linked by, whichever kind it is. */
export function directoryEntryId(entry: ClientDirectoryItem): string {
  return entry.kind === 'invitation' ? entry.invitation_id : entry.relationship_id
}

/**
 * What a person is called in the list. An invitation has no name to show,
 * because until somebody accepts, no person exists — so the masked contact
 * stands in for one, and the caller can tell the difference.
 */
export function directoryEntryLabel(entry: ClientDirectoryItem): string {
  return entry.kind === 'invitation' ? entry.contact_hint : entry.display_name
}

export function clientInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase('es-CO') ?? '')
    .join('')
}
