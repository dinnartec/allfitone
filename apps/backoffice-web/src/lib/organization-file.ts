/**
 * Presentation rules for a gym's file (`HU-BO-013`).
 *
 * Three things shape it that the schema cannot carry.
 *
 * **People are identifiers here.** Ordinary support reads identifiers, states, dates
 * and counters, so the owner and the team come without names. Opening a person's own
 * card still asks for the case that justifies it, and the file says so instead of
 * offering a link that would fail.
 *
 * **Withheld is not missing.** A natural person's site address is kept back because
 * it can be their home. The screen says it was withheld, so nobody reads it as a gym
 * that never gave one.
 *
 * **What Allfit does not store yet is not something the gym lacks.** People served,
 * plans, the payment method and Premium have no tables, and the file lists them as
 * such rather than as empty.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { isValidCaseReference } from './support-metadata'

export type OrganizationFile = AllfitV1Schemas['BackofficeOrganizationFile']
export type FileTeamMember = OrganizationFile['team'][number]
export type FileSite = OrganizationFile['sites'][number]
export type TeamRole = FileTeamMember['roles'][number]

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  coach: 'Coach',
  staff: 'Staff',
}

export function rolesLabel(roles: readonly TeamRole[]): string {
  return roles.length === 0 ? 'Sin rol vigente' : roles.map((role) => ROLE_LABELS[role]).join(' · ')
}

export function teamSentence(file: OrganizationFile): string {
  const { active, terminated } = file.team_counts
  if (active === 0) {
    return file.organization.status === 'unclaimed' || file.organization.status === 'cancelled'
      ? 'Nadie forma parte del equipo: el gimnasio nunca tuvo dueño.'
      : 'Nadie forma parte del equipo en este momento.'
  }
  const current = active === 1 ? '1 persona activa' : `${active} personas activas`
  const former =
    terminated === 0
      ? ''
      : terminated === 1
        ? ', y 1 que ya no está'
        : `, y ${terminated} que ya no están`
  const truncated = file.team_truncated ? ' La lista muestra las primeras 200.' : ''
  return `${current}${former}.${truncated}`
}

export function siteAddress(site: FileSite): string {
  if (site.address) return site.address
  return site.address_withheld
    ? 'Reservada: puede ser la casa de quien atiende'
    : 'Sin dirección declarada'
}

export function responsibleLabel(file: OrganizationFile): string {
  return file.organization.party_kind === 'legal_entity'
    ? (file.organization.legal_name ?? 'Una empresa')
    : 'Una persona natural. Su nombre no se muestra aquí.'
}

export const NOT_MODELLED_ITEMS: readonly string[] = [
  'Cuántas personas atiende y en qué estado están esas relaciones',
  'Sus planes publicados y sus suscriptores',
  'Si tiene su medio de cobro conectado',
  'Si está habilitado para dar Premium a sus clientes',
]

export const NOT_MODELLED_NOTE =
  'Todavía no existen en la plataforma. No es que el gimnasio no los tenga: es que Allfit aún no los guarda.'

export const IDENTIFIERS_NOTE =
  'El equipo aparece por identificador, nunca por nombre. Cada persona que muestra esta ficha queda en el registro de accesos, y abrir la ficha de una de ellas pide la referencia del caso que lo justifica.'

/** Only a traceable case opens a person's card; without one there is no link to offer. */
export function memberCardHref(personId: string, caseReference: string): string | undefined {
  if (!isValidCaseReference(caseReference)) return undefined
  return `/people/${personId}?case_reference=${encodeURIComponent(caseReference.trim())}`
}

export function handsOverHere(file: OrganizationFile): boolean {
  return file.organization.status === 'unclaimed' || file.organization.status === 'cancelled'
}

export function fileMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente un deber que permita abrir la ficha: soporte o ciclo de vida de gimnasios. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'not-found': 'Ese gimnasio no existe.',
    'invalid-request': 'La dirección de la ficha no se pudo leer. Ábrela desde el directorio.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo abrir la ficha.'
}
