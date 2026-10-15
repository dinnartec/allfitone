/**
 * Presentation rules for the organization directory.
 *
 * The directory answers "where is this gym, and is it operating?" — the question
 * the team asks before opening a gym's file. Three things shape it that the schema
 * cannot carry.
 *
 * **Unclaimed is not a quiet active.** An unclaimed organization exists because
 * Allfit created it for a sale and its owner has not accepted yet. It does not
 * operate: nobody joins its team and it serves nobody. Rendered like an active
 * one, it reads as a working gym that merely has little activity.
 *
 * **An unknown count is not zero.** How many people an organization serves is
 * counted from service relationships, which do not exist yet. Until they do the
 * server returns null, and the screen says the number is not available instead of
 * printing a zero that would say the gym serves nobody.
 *
 * **A search is a question.** One letter would page the whole directory under
 * another name, so the screen asks for two before it asks the server.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationSummary = AllfitV1Schemas['BackofficeOrganizationSummary']
export type OrganizationPage = AllfitV1Schemas['BackofficeOrganizationPage']
export type OrganizationStatus = AllfitV1Schemas['OrganizationLifecycleStatus']

/** Operating first: it is what the team is usually looking for. */
export const ORGANIZATION_STATUSES: readonly OrganizationStatus[] = [
  'active',
  'suspended',
  'unclaimed',
  'closed',
  'cancelled',
]

const STATUS_LABELS: Record<OrganizationStatus, string> = {
  active: 'Operando',
  suspended: 'Suspendido',
  unclaimed: 'Sin reclamar',
  closed: 'Cerrado',
  cancelled: 'Cancelado sin reclamar',
}

export function statusLabel(status: OrganizationStatus): string {
  return STATUS_LABELS[status]
}

/** What the closed filter says, including when it filters nothing. */
export function statusFilterLabel(status: OrganizationStatus | 'any'): string {
  return status === 'any' ? 'Todos' : STATUS_LABELS[status]
}

const STATUS_MEANINGS: Record<OrganizationStatus, string> = {
  active: 'Su dueño lo reclamó y está operando.',
  suspended:
    'Allfit le cortó el servicio y no opera. No terminó ninguna relación ni se le quitó ningún permiso: se levanta y vuelve a operar.',
  unclaimed: 'Allfit lo creó y su dueño todavía no aceptó. Existe, pero no opera.',
  closed: 'Operó y se cerró.',
  cancelled: 'Allfit lo creó, nadie lo reclamó y se canceló.',
}

export function statusMeaning(status: OrganizationStatus): string {
  return STATUS_MEANINGS[status]
}

export type StatusTone = 'success' | 'warning' | 'secondary'

/** Only the two states the team acts on stand out; the ended ones stay neutral. */
export function statusTone(status: OrganizationStatus): StatusTone {
  if (status === 'active') return 'success'
  if (status === 'unclaimed') return 'warning'
  return 'secondary'
}

export function peopleServedLabel(value: number): string {
  return value === 1 ? '1 persona' : `${value} personas`
}

export interface DirectoryFilters {
  query: string
  status: OrganizationStatus | 'any'
}

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = { query: '', status: 'any' }

/** A notice links here with a state; anything outside the closed set opens unfiltered. */
export function directoryFiltersFromStatus(status: string | null): DirectoryFilters {
  const known = ORGANIZATION_STATUSES.find((candidate) => candidate === status)
  return known ? { query: '', status: known } : EMPTY_DIRECTORY_FILTERS
}

export type DirectoryFilterIssue = 'short-query' | 'long-query'

const MAX_QUERY = 120

export function directoryFilterIssue(filters: DirectoryFilters): DirectoryFilterIssue | undefined {
  const query = filters.query.trim()
  if (query !== '' && query.length < 2) return 'short-query'
  if (query.length > MAX_QUERY) return 'long-query'
  return undefined
}

const FILTER_MESSAGES: Record<DirectoryFilterIssue, string> = {
  'short-query':
    'Escribe al menos dos letras del nombre. Con una sola, la búsqueda sería el directorio completo.',
  'long-query': 'El nombre buscado es demasiado largo. Usa solo una parte del nombre.',
}

export function directoryFilterIssueMessage(issue: DirectoryFilterIssue): string {
  return FILTER_MESSAGES[issue]
}

/** The query the API expects, with the empty fields left out rather than sent blank. */
export function toDirectoryQuery(
  filters: DirectoryFilters,
  cursor?: string,
): { q?: string; status?: OrganizationStatus; cursor?: string } {
  const query = filters.query.trim()
  return {
    ...(query === '' ? {} : { q: query }),
    ...(filters.status === 'any' ? {} : { status: filters.status }),
    ...(cursor ? { cursor } : {}),
  }
}

export function isFiltered(filters: DirectoryFilters): boolean {
  return filters.query.trim() !== '' || filters.status !== 'any'
}

/**
 * What the screen says about the answer as a whole. "There are more" is said
 * outright, so a partial first page is never read as the whole directory.
 */
export function directoryAnswer(
  shown: number,
  hasMore: boolean,
  filters: DirectoryFilters,
): string {
  if (shown === 0) {
    return isFiltered(filters)
      ? 'Ningún gimnasio coincide con esta búsqueda.'
      : 'Todavía no hay ningún gimnasio en Allfit.'
  }
  const count = shown === 1 ? '1 gimnasio' : `${shown} gimnasios`
  return hasMore ? `${count} por ahora. Hay más: cárgalos al final de la lista.` : `${count}.`
}

export function directoryMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente un deber que permita ver el directorio: soporte o ciclo de vida de gimnasios. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'invalid-request':
      'Alguno de los filtros no se pudo leer. Se rechaza en vez de ignorarlo, porque ignorarlo ampliaría la búsqueda.',
    'validation-failed': 'La búsqueda no cumple el contrato. Revisa el nombre buscado.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer el directorio.'
}
