/**
 * The rules the site form needs before it sends anything.
 *
 * Permission is read from the role catalog the server publishes rather than
 * from a list of role codes written here. PostgreSQL grants site management
 * through the `manage_sites` capability, and a copy of that mapping in the
 * client is a second source of truth that drifts silently the day the grant
 * changes.
 */
import type {
  OrganizationRole,
  OrganizationSite,
  OrganizationSiteCreate,
  OrganizationSiteUpdate,
} from './studio-api'

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

/**
 * The revision an edit is based on, in the form the contract publishes:
 * `"organization-site:<id>:r<revision>"`. The server compares it with the row
 * it holds and refuses the write if someone else moved it first, which is what
 * keeps two people editing one site from overwriting each other in silence.
 */
export function siteEtag(site: OrganizationSite): string {
  return `"organization-site:${site.id}:r${site.revision_number}"`
}

/**
 * Only the fields that actually moved, or null when none did.
 *
 * Two reasons it is not simply the whole draft. The contract requires at least
 * one property, so an unchanged form has nothing legal to send; and a PATCH
 * that restates every field would overwrite an edit someone else made to a
 * field this person never touched.
 */
export function siteChanges(
  site: OrganizationSite,
  draft: SiteDraft,
): OrganizationSiteUpdate | null {
  const name = draft.name.trim()
  const address = draft.address.trim() ? draft.address.trim() : null
  const changes: OrganizationSiteUpdate = {
    ...(name !== site.name ? { name } : {}),
    ...(address !== site.address ? { address } : {}),
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export function siteToDraft(site: OrganizationSite): SiteDraft {
  return { name: site.name, address: site.address ?? '' }
}
