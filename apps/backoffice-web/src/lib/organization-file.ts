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
 * **A gym with nothing published sells nothing, and that is a fact.** Plans, the
 * payment method and Pro all have tables now, so an empty list means the gym publishes
 * no plan rather than Allfit not knowing. The one thing still missing says so on its
 * own line, never as a zero.
 *
 * **No credential reaches this screen.** The file carries whether the gym can be paid
 * and which provider it uses. The account reference and the vault key are in a table
 * this reader has no policy for, so there is nothing here to hide by hand.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatAmount } from './platform-plans'
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

/**
 * How many people the gym serves. Unlike the business panel, zero is a fact here and
 * is said out loud: this is one gym, not an aggregate that could single somebody out.
 */
export function peopleServedSentence(file: OrganizationFile): string {
  const { active, terminated } = file.relationship_counts
  const former =
    terminated === 0
      ? ''
      : terminated === 1
        ? ', y 1 relación ya terminó'
        : `, y ${terminated} relaciones ya terminaron`

  if (active === 0) {
    return terminated === 0
      ? 'Todavía no atiende a nadie.'
      : `No atiende a nadie en este momento${former}.`
  }
  const current = active === 1 ? 'Atiende a 1 persona' : `Atiende a ${active} personas`
  return `${current}${former}.`
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

export type FilePlan = OrganizationFile['plans'][number]

export const NO_PLANS_NOTE =
  'Este gimnasio no tiene ningún plan publicado. No cobra por la plataforma: entrenar y pagar son cosas separadas.'

/** The plan, the price in force, and how many of its clients are paying it. */
export function planLine(plan: FilePlan): string {
  const price = formatAmount(plan.amount_minor, plan.currency_code)
  const period = plan.billing_period === 'year' ? 'al año' : 'al mes'
  const subscribers =
    plan.subscribers === 0
      ? 'nadie lo paga todavía'
      : plan.subscribers === 1
        ? '1 persona lo paga'
        : `${plan.subscribers} personas lo pagan`
  return `${price} ${period} · ${subscribers}`
}

/**
 * Whether the gym can be paid. Never a credential: the provider is as far as this goes,
 * and that is a property of the connection, not of the account behind it.
 */
export function paymentMethodLine(file: OrganizationFile): string {
  const method = file.payment_method
  if (!method.connected) {
    return 'Sin medio de cobro conectado. Hasta que lo conecte no puede cobrarle a nadie.'
  }
  return `Conectado con ${providerLabel(method.provider)}. Ninguna credencial se muestra aquí ni puede leerse desde el Backoffice.`
}

const PROVIDERS: Record<string, string> = {
  mercado_pago: 'Mercado Pago',
  wompi: 'Wompi',
}

export function providerLabel(provider: string | null): string {
  if (provider === null) return 'una pasarela'
  return PROVIDERS[provider] ?? provider
}

/**
 * Criterion 6. There is no per-gym switch: by `ADR-043` every gym that operates gives
 * Pro to the people it serves, so what the screen explains is the condition and not a
 * setting somebody could change here.
 */
export function premiumLine(file: OrganizationFile): string {
  const premium = file.premium
  if (premium.gives_pro) {
    return 'Sus clientes tienen Allfit Pro por entrenar aquí. No se activa por gimnasio: lo da cualquiera que opere.'
  }
  if (premium.reason === 'organization_not_active') {
    return 'Mientras no opere, sus clientes no tienen Pro por él. Reclamarlo o reactivarlo se lo devuelve, sin perder ningún dato.'
  }
  return 'Ningún plan Pro está publicado todavía, así que ningún gimnasio lo da.'
}

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
