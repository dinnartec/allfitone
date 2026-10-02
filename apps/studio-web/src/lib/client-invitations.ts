/**
 * The rules the invitation form needs before it sends anything.
 *
 * Permission is read from the role catalog the server publishes rather than
 * from a list of role codes written here. PostgreSQL grants inviting through
 * the `invite_clients` capability, and a copy of that mapping in the client is
 * a second source of truth that drifts silently the day the grant changes.
 */
import type { ClientInvitationCreate, OfferableScope, OrganizationRole } from './studio-api'

const INVITE_CLIENTS = 'invite_clients'

/**
 * Every invitation asks to read, never to write.
 *
 * The scope table in the domain glossary is explicit that
 * `prior_training_history`, `nutrition_intake` and `nutrition_media` never
 * admit professional writing at all, and that the rest take `contribute` only
 * on an explicit further acceptance. A checkbox that silently asked for write
 * access would be exactly the thing that rule exists to prevent, so the form
 * does not offer the choice: it asks to read, and raising that is a separate,
 * explicit conversation nobody has designed yet.
 */
const INVITATION_ACCESS_LEVEL = 'read' as const

export interface InvitationDraft {
  contact: string
  /** Scope codes the professional ticked, in catalogue order. */
  scopeCodes: string[]
}

export type InvitationDraftErrors = Partial<Record<'contact' | 'scopes', string>>

export function canInviteClients(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === INVITE_CLIENTS),
  )
}

/**
 * The address is checked for shape only. Whether it belongs to somebody, or to
 * somebody who already has an account, is deliberately not knowable here: the
 * command never reveals it, so a professional cannot use an invitation to find
 * out who is registered.
 */
export function validateDraft(draft: InvitationDraft): InvitationDraftErrors {
  const errors: InvitationDraftErrors = {}
  const contact = draft.contact.trim()
  if (!contact) {
    errors.contact = 'Escribe el correo de la persona que quieres invitar.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contact)) {
    errors.contact = 'Ese correo no parece válido. Revísalo.'
  } else if (contact.length > 254) {
    errors.contact = 'Ese correo es demasiado largo.'
  }
  if (draft.scopeCodes.length === 0) {
    errors.scopes = 'Marca al menos un permiso. Una invitación que no pide nada no sirve de nada.'
  }
  return errors
}

/**
 * The purpose and the contract text come from the catalogue, never from this
 * screen. A gym writing its own justification for wanting health data writes it
 * with nobody reviewing it, and the snapshot is what the person will be shown
 * and what the invitation freezes.
 */
export function invitationBody(
  draft: InvitationDraft,
  catalog: readonly OfferableScope[],
): ClientInvitationCreate {
  const chosen = catalog.filter((scope) => draft.scopeCodes.includes(scope.scope_code))
  const scopes: ClientInvitationCreate['scopes'] = chosen.map((scope) => {
    // What the person will be shown, frozen into the invitation as it is sent.
    // Editing the catalogue later never rewrites what somebody already read.
    const presented_snapshot: Record<string, unknown> = {
      display_name: scope.display_name,
      description: scope.description,
      version_number: scope.version_number,
    }
    return {
      scope_code: scope.scope_code,
      access_level: INVITATION_ACCESS_LEVEL,
      purpose: scope.default_purpose,
      presented_snapshot,
    }
  })
  return { channel: 'email', contact: draft.contact.trim().toLowerCase(), scopes }
}

/** Keeps the ticked scopes in catalogue order, whatever order they were ticked. */
export function toggleScope(
  scopeCodes: readonly string[],
  code: string,
  catalog: readonly OfferableScope[],
): string[] {
  const next = scopeCodes.includes(code)
    ? scopeCodes.filter((entry) => entry !== code)
    : [...scopeCodes, code]
  return catalog.map((scope) => scope.scope_code).filter((entry) => next.includes(entry))
}
