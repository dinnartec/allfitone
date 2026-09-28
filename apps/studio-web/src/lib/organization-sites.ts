/**
 * The rules the site form needs before it sends anything.
 *
 * Permission is read from the role catalog the server publishes rather than
 * from a list of role codes written here. PostgreSQL grants site management
 * through the `manage_sites` capability, and a copy of that mapping in the
 * client is a second source of truth that drifts silently the day the grant
 * changes.
 */
import type { OrganizationRole, OrganizationSiteCreate } from './studio-api'

const MANAGE_SITES = 'manage_sites'

export interface SiteDraft {
  name: string
  address: string
}

export type SiteDraftErrors = Partial<Record<keyof SiteDraft, string>>

export function canManageSites(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === MANAGE_SITES),
  )
}

export function siteDraftErrors(draft: SiteDraft): SiteDraftErrors {
  return draft.name.trim() ? {} : { name: 'Escribe el nombre de la sede.' }
}

/**
 * An address of only spaces is not an address. PostgreSQL rejects a present
 * but blank one, so it leaves as absent instead of travelling to come back 422.
 */
export function siteDraftToRequest(draft: SiteDraft): OrganizationSiteCreate {
  const address = draft.address.trim()
  return {
    name: draft.name.trim(),
    ...(address ? { address } : {}),
  }
}
