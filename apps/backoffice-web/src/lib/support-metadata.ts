/**
 * Presentation rules for the minimised support projection.
 *
 * Nothing here decides access and nothing here hides data: the server already
 * removed what must not travel. What lives here is the vocabulary an operator
 * reads, and one distinction the API went out of its way to preserve — the
 * difference between "this person has none" and "Allfit does not store this
 * yet". A screen that flattens the two tells the operator a fact about the
 * person that is really a fact about us.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type SupportPersonMetadata = AllfitV1Schemas['SupportPersonMetadata']
export type SupportPeopleSearch = AllfitV1Schemas['SupportPeopleSearch']
export type SupportBlockAvailability = AllfitV1Schemas['SupportBlockAvailability']

export type SupportLookupKind = 'identifier' | 'email' | 'phone'

export const SUPPORT_LOOKUP_KINDS: readonly SupportLookupKind[] = ['identifier', 'email', 'phone']

const LOOKUP_LABELS: Record<SupportLookupKind, string> = {
  identifier: 'Identificador',
  email: 'Correo exacto',
  phone: 'Teléfono exacto',
}

const LOOKUP_PLACEHOLDERS: Record<SupportLookupKind, string> = {
  identifier: '019a5000-0000-7000-8000-000000000005',
  email: 'persona@ejemplo.com',
  phone: '+573001234567',
}

export function lookupLabel(kind: SupportLookupKind): string {
  return LOOKUP_LABELS[kind]
}

export function lookupPlaceholder(kind: SupportLookupKind): string {
  return LOOKUP_PLACEHOLDERS[kind]
}

const CASE_REFERENCE = /^[A-Z][A-Z0-9_-]{2,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/
const PHONE = /^\+[1-9][0-9]{6,14}$/

export function isValidCaseReference(value: string): boolean {
  return CASE_REFERENCE.test(value.trim())
}

/**
 * Checked before the request travels so a typo is not recorded as a search. The
 * database refuses the same shapes; this exists to answer the operator sooner,
 * never to let something through that the server would reject.
 */
export function isValidLookup(kind: SupportLookupKind, value: string): boolean {
  const trimmed = value.trim()
  if (kind === 'identifier') return UUID.test(trimmed)
  if (kind === 'email') return EMAIL.test(trimmed)
  return PHONE.test(trimmed)
}

export function lookupIssueMessage(kind: SupportLookupKind): string {
  if (kind === 'identifier') return 'El identificador no tiene la forma de un UUID.'
  if (kind === 'email') return 'Escribe el correo completo, tal como la persona lo entregó.'
  return 'El teléfono va en formato internacional, empezando por «+».'
}

export interface SupportBlock {
  title: string
  availability: SupportBlockAvailability
}

/**
 * The four blocks `HU-BO-007` criterion 2 asks for that have nothing behind them
 * yet. They are listed rather than omitted: an operator who does not see
 * "relaciones" cannot tell whether the screen forgot it or the platform lacks it.
 */
export function absentBlocks(metadata: SupportPersonMetadata): SupportBlock[] {
  return [
    { title: 'Relaciones de servicio', availability: metadata.relationships_availability },
    { title: 'Plan asignado', availability: metadata.plan_availability },
    { title: 'Premium', availability: metadata.premium_availability },
    { title: 'Permisos concedidos', availability: metadata.permissions_availability },
  ]
}

const AVAILABILITY_LABELS: Record<SupportBlockAvailability, string> = {
  available: 'Disponible',
  unknown: 'Sin datos',
  not_modelled: 'Allfit no lo guarda todavía',
}

export function availabilityLabel(availability: SupportBlockAvailability): string {
  return AVAILABILITY_LABELS[availability]
}

export function availabilityExplanation(availability: SupportBlockAvailability): string {
  if (availability === 'available') return 'Hay información y se muestra arriba.'
  if (availability === 'unknown') return 'Esta persona no tiene nada registrado aquí.'
  return 'Todavía no existe dónde guardarlo, así que no es una afirmación sobre la persona.'
}

export function verificationLabel(verifiedAt: string | null): string {
  return verifiedAt ? 'Verificado' : 'Sin verificar'
}

/**
 * What the operator is told when a read is refused. `forbidden` is the common
 * one and deserves the whole explanation: the duty is temporary by design, so
 * "it worked yesterday" is the expected experience rather than a bug.
 */
export function supportMetadataMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber de diagnóstico de soporte. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'not-found': 'No hay ninguna persona con ese identificador.',
    'invalid-request': 'Falta la referencia del caso o el dato buscado no tiene la forma esperada.',
    'validation-failed': 'El servidor rechazó la referencia del caso. Revisa su formato.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer la información de soporte.'
}
