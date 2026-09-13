/**
 * Presentation rules for the access log.
 *
 * This screen answers one question — "did anyone from the team look at this
 * person's data?" — and the answer is used to reply to a real person who asked.
 * That shapes three things the schema cannot carry.
 *
 * **An incomplete answer must never look complete.** The server removes the
 * records belonging to break-glass windows this auditor requested or approved, and
 * reports how many. If the screen shows the list without the number, an auditor
 * reads "nothing" and says "nobody looked" — when somebody did, and it was them.
 * So the count is stated alongside the list, including when the list is empty.
 *
 * **A break-glass access is not one row among many.** It is the exceptional path,
 * with a named case behind it, and it is the row an auditor is usually looking
 * for. Rendering it identically to an ordinary operational read buries it.
 *
 * **The record is not the content.** The log says somebody read
 * `nutrition.intake_entries`; it cannot say what they saw, and the screen says so
 * rather than leaving an auditor hunting for a detail view that does not exist.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type AccessEvent = AllfitV1Schemas['AccessEvent']
export type AccessEventPage = AllfitV1Schemas['AccessEventPage']
export type AccessMode = AllfitV1Schemas['AccessMode']

const MODE_LABELS: Record<AccessMode, string> = {
  live: 'Permiso vigente',
  frozen: 'Permiso congelado',
  break_glass: 'Acceso excepcional',
  organization_operational: 'Operación del gimnasio',
  support_metadata: 'Lectura del equipo de Allfit',
}

export function modeLabel(mode: AccessMode): string {
  return MODE_LABELS[mode]
}

/**
 * What authorised the access, said as a sentence. An auditor answering a person's
 * question needs to explain the basis, not name the enum.
 */
const MODE_BASIS: Record<AccessMode, string> = {
  live: 'La persona tenía un permiso vigente que cubría este dato.',
  frozen:
    'La persona había revocado el permiso, y la lectura fue del histórico que quedó congelado.',
  break_glass:
    'No había permiso. Se abrió una ventana excepcional aprobada por otra persona, para un caso concreto.',
  organization_operational:
    'Fue una operación del gimnasio sobre datos que administra, no una lectura de datos de salud.',
  support_metadata:
    'No hubo permiso de la persona: la hizo alguien del equipo de Allfit ejerciendo un deber de plataforma.',
}

export function modeBasis(mode: AccessMode): string {
  return MODE_BASIS[mode]
}

export type ModeTone = 'destructive' | 'warning' | 'secondary'

/**
 * Break-glass is the only exceptional mode. A read by Allfit's own team is a warning
 * because it is the question this log exists to answer, and so is `frozen`, because
 * a read of revoked data deserves a second look. The rest stay neutral.
 */
export function modeTone(mode: AccessMode): ModeTone {
  if (mode === 'break_glass') return 'destructive'
  if (mode === 'frozen' || mode === 'support_metadata') return 'warning'
  return 'secondary'
}

export function isExceptional(event: AccessEvent): boolean {
  return event.access_mode === 'break_glass'
}

/** A denied attempt is evidence too, and it is not a failure of the log. */
export function resultLabel(result: string): string {
  return result === 'allowed' ? 'Entregó contenido' : 'Denegado y registrado'
}

export interface AccessLogFilters {
  actorPersonId: string
  subjectPersonId: string
  from: string
  to: string
}

export const EMPTY_FILTERS: AccessLogFilters = {
  actorPersonId: '',
  subjectPersonId: '',
  from: '',
  to: '',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FilterIssue = 'actor' | 'subject' | 'range' | 'unfiltered'

/**
 * The screen refuses to ask an unfiltered question. Reading the whole log is not
 * auditing — it is browsing other people's access records, and every row here is
 * about a real person. An auditor always arrives with a name or a window.
 */
export function filterIssue(filters: AccessLogFilters): FilterIssue | undefined {
  if (filters.actorPersonId.trim() !== '' && !UUID.test(filters.actorPersonId.trim())) {
    return 'actor'
  }
  if (filters.subjectPersonId.trim() !== '' && !UUID.test(filters.subjectPersonId.trim())) {
    return 'subject'
  }
  if (filters.from !== '' && filters.to !== '' && filters.from >= filters.to) return 'range'
  if (
    filters.actorPersonId.trim() === '' &&
    filters.subjectPersonId.trim() === '' &&
    filters.from === '' &&
    filters.to === ''
  ) {
    return 'unfiltered'
  }
  return undefined
}

const FILTER_MESSAGES: Record<FilterIssue, string> = {
  actor: 'El identificador del integrante del equipo no tiene la forma de un id.',
  subject: 'El identificador de la persona afectada no tiene la forma de un id.',
  range: 'La fecha de inicio va antes de la fecha de fin.',
  unfiltered:
    'Acota la consulta: por integrante del equipo, por persona afectada o por fechas. El registro completo no se navega.',
}

export function filterIssueMessage(issue: FilterIssue): string {
  return FILTER_MESSAGES[issue]
}

/** The query the API expects, with the empty fields left out rather than sent blank. */
export function toQuery(filters: AccessLogFilters): Record<string, string | undefined> {
  const actor = filters.actorPersonId.trim()
  const subject = filters.subjectPersonId.trim()
  return {
    actor_person_id: actor === '' ? undefined : actor,
    subject_person_id: subject === '' ? undefined : subject,
    from: filters.from === '' ? undefined : new Date(filters.from).toISOString(),
    to: filters.to === '' ? undefined : new Date(filters.to).toISOString(),
  }
}

/**
 * What the screen says about the answer as a whole. The withheld count is part of
 * the answer, not a footnote: an auditor who cannot see it will report a finding
 * that is wrong.
 */
export function answerSentence(page: AccessEventPage): string {
  const shown = page.items.length
  const withheld = page.withheld_from_you

  if (shown === 0 && withheld === 0) {
    return 'No hay ningún acceso registrado que cumpla estos filtros.'
  }
  if (shown === 0) {
    return `Ninguno de los accesos que cumplen estos filtros te corresponde auditar: hay ${countPhrase(withheld)} de una ventana excepcional que pediste o aprobaste. Esta consulta no responde la pregunta — pásala a otra persona.`
  }
  if (withheld === 0) {
    return `${countPhrase(shown)} en total.`
  }
  return `${countPhrase(shown)}, y ${countPhrase(withheld)} más que no te corresponde auditar porque pediste o aprobaste su ventana excepcional. Para esos, pásale el caso a otra persona.`
}

function countPhrase(count: number): string {
  return count === 1 ? '1 acceso' : `${count} accesos`
}

export function hasWithheld(page: AccessEventPage): boolean {
  return page.withheld_from_you > 0
}

export function accessLogMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber de auditoría que esta consulta exige. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'invalid-request':
      'Alguno de los filtros no se pudo leer. Se rechaza en vez de ignorarlo, porque ignorarlo ampliaría la consulta.',
    'validation-failed': 'La consulta no cumple el contrato. Revisa los identificadores y fechas.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo completar la consulta.'
}
