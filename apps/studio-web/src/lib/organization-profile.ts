/**
 * The rules the organization form needs before it sends anything.
 *
 * Permission is read from the role catalog the server publishes, for the same
 * reason the site form reads it: PostgreSQL grants this through the
 * `manage_organization` capability, and a list of role codes written here is a
 * second source of truth that drifts the day the grant changes.
 */
import type { Organization, OrganizationRole, OrganizationUpdate } from './studio-api'

const MANAGE_ORGANIZATION = 'manage_organization'

export type OrganizationTypeCode = Organization['type_code']

/*
 * Which types an organization may still become.
 *
 * This mirrors `organizations.organization_type_transitions`, seeded in
 * `20260817154245_studio_organization_team_core.sql` and asserted row by row by
 * `T-ORG-COMMANDS-01`. It is a copy, and copies drift — three things keep this
 * one honest:
 *
 * - The trigger `trg_organizations_before_update_type_transition` is still the
 *   enforcer. This list can only be narrower than the server's, never wider, so
 *   the worst it can do is fail to offer a move that would have been allowed.
 * - A move it fails to catch still comes back 422, and the screen says so.
 * - The pgTAP test pins the table's contents, so adding a transition there
 *   fails a test and sends whoever did it looking for this list.
 *
 * The table is readable by nobody outside the database — the migration revokes
 * it even from `allfit_api` — so the client cannot ask. Publishing it through
 * the API is the fix, and it needs a migration.
 */
const TYPE_TRANSITIONS: Record<OrganizationTypeCode, readonly OrganizationTypeCode[]> = {
  professional_practice: ['gym', 'studio'],
  gym: [],
  studio: [],
}

export interface OrganizationDraft {
  displayName: string
  legalName: string
  typeCode: OrganizationTypeCode
}

export type OrganizationDraftErrors = Partial<Record<keyof OrganizationDraft, string>>

export function canManageOrganization(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === MANAGE_ORGANIZATION),
  )
}

/**
 * What the type field may offer: where it stands today, plus wherever it may
 * still go. The current type belongs in the list because a select that cannot
 * show its own value is broken, not because staying put is a transition.
 */
export function allowedTypeCodes(current: OrganizationTypeCode): readonly OrganizationTypeCode[] {
  return [current, ...TYPE_TRANSITIONS[current]]
}

/** A type with nowhere to go is a fact to read, not a field to edit. */
export function typeIsFixed(current: OrganizationTypeCode): boolean {
  return TYPE_TRANSITIONS[current].length === 0
}

export function organizationDraftErrors(draft: OrganizationDraft): OrganizationDraftErrors {
  return draft.displayName.trim() ? {} : { displayName: 'Escribe el nombre de la organización.' }
}

export function organizationToDraft(organization: Organization): OrganizationDraft {
  return {
    displayName: organization.display_name,
    legalName: organization.legal_name ?? '',
    typeCode: organization.type_code,
  }
}

/**
 * Only the fields that actually moved, or null when none did.
 *
 * Same two reasons as the site form: the contract requires at least one
 * property, so an untouched form has nothing legal to send; and a PATCH that
 * restated every field would overwrite an edit someone else made to a field
 * this person never touched.
 */
export function organizationChanges(
  organization: Organization,
  draft: OrganizationDraft,
): OrganizationUpdate | null {
  const displayName = draft.displayName.trim()
  const legalName = draft.legalName.trim() ? draft.legalName.trim() : null
  const changes: OrganizationUpdate = {
    ...(displayName !== organization.display_name ? { display_name: displayName } : {}),
    ...(legalName !== organization.legal_name ? { legal_name: legalName } : {}),
    ...(draft.typeCode !== organization.type_code ? { type_code: draft.typeCode } : {}),
  }
  return Object.keys(changes).length > 0 ? changes : null
}
