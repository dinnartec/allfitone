/**
 * `OP-SUP-006` — presentation rules for reviewing a break-glass case that was used.
 *
 * **This screen is a debt, not a list.** Every row is an obligation the platform owes
 * and has not met. It is sorted by what is most overdue and it says so in words,
 * because a reviewer who reads it as an inbox will work the newest first, which is the
 * wrong end.
 *
 * **Overdue and late are different facts.** Overdue is a case still waiting past its
 * day. Late is a review that happened after that day. A reviewed case stops being
 * overdue and stays late for good, and conflating them would let a backlog disappear
 * by being worked slowly.
 *
 * **Refusing a late review is the one thing the screen must not imply.** The deadline
 * exists to make the delay visible, not to void the obligation: a case nobody reviews
 * is worse than a case reviewed a day late, so the overdue row still carries its
 * verdict buttons and says what is now true rather than what is now impossible.
 *
 * **An incident is not a worse verdict.** It says somebody has to act, so it is worded
 * as a handoff rather than as a grade.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BreakGlassReview = AllfitV1Schemas['BreakGlassReview']
export type BreakGlassReviewOutcome = AllfitV1Schemas['BreakGlassReviewOutcome']

export const REVIEW_OUTCOMES: readonly BreakGlassReviewOutcome[] = [
  'justified',
  'unjustified',
  'incident_opened',
]

export const EMPTY_QUEUE = 'No hay ningún caso esperando revisión. Es lo que debe pasar.'

export const WHY_IT_IS_REVIEWED =
  'Break-glass es el único camino que lee los datos de una persona sin ella. Todos los demás controles actúan antes de la lectura; esta revisión es la que actúa después, y tiene que hacerse sobre el 100 % de los casos que se usaron.'

export const LATE_IS_STILL_REQUIRED =
  'Pasadas las 24 horas la revisión sigue siendo obligatoria y se puede hacer. Queda registrada como tardía, porque un caso sin revisar es peor que uno revisado tarde.'

const OUTCOME_LABELS: Record<BreakGlassReviewOutcome, string> = {
  justified: 'Justificado',
  unjustified: 'No justificado',
  incident_opened: 'Abrir incidente',
}

const OUTCOME_MEANINGS: Record<BreakGlassReviewOutcome, string> = {
  justified: 'El acceso correspondía al caso, al propósito y a las categorías aprobadas.',
  unjustified: 'El acceso no correspondía. Queda registrado así y el caso no se reabre.',
  incident_opened:
    'Además de registrarlo, esto avisa a quien deba actuar. No es un «no justificado» peor: es el que pide que alguien haga algo.',
}

export function outcomeLabel(outcome: BreakGlassReviewOutcome): string {
  return OUTCOME_LABELS[outcome]
}

export function outcomeMeaning(outcome: BreakGlassReviewOutcome): string {
  return OUTCOME_MEANINGS[outcome]
}

/** What this row is: a debt, how old, and whether its day has passed. */
export function debtSentence(review: BreakGlassReview, now: Date): string {
  if (review.first_exercised_at === null) {
    return 'Esta ventana se aprobó y nunca se usó, así que no hay nada que revisar.'
  }
  const hours = hoursSince(review.first_exercised_at, now)
  const used =
    hours < 1 ? 'hace menos de una hora' : hours === 1 ? 'hace 1 hora' : `hace ${hours} horas`
  const reads = review.exercise_count === 1 ? '1 lectura' : `${review.exercise_count} lecturas`
  return `Se usó ${used}, ${reads} en total.`
}

/** Overdue says the day passed and nobody has answered. It is never a figure. */
export function dueSentence(review: BreakGlassReview, now: Date): string {
  if (review.review_due_at === null) return 'Sin plazo: la ventana no se usó.'
  if (review.reviewed_at !== null) {
    return review.reviewed_late === true
      ? 'Se revisó fuera de plazo. Queda registrado así.'
      : 'Se revisó dentro de las 24 horas.'
  }
  const hours = hoursSince(review.review_due_at, now)
  if (!review.overdue) {
    const left = Math.max(0, -hours)
    return left <= 1 ? 'Queda menos de una hora de plazo.' : `Quedan ${left} horas de plazo.`
  }
  return hours <= 1
    ? 'Venció el plazo de 24 horas. Sigue pendiente.'
    : `Venció el plazo hace ${hours} horas. Sigue pendiente.`
}

export function reviewBadge(review: BreakGlassReview): {
  label: string
  variant: 'secondary' | 'success' | 'warning' | 'destructive'
} {
  if (review.reviewed_at !== null) {
    if (review.review_outcome === 'incident_opened') {
      return { label: 'Incidente', variant: 'destructive' }
    }
    return review.reviewed_late === true
      ? { label: 'Revisado tarde', variant: 'warning' }
      : { label: 'Revisado', variant: 'success' }
  }
  return review.overdue
    ? { label: 'Vencido', variant: 'destructive' }
    : { label: 'Pendiente', variant: 'secondary' }
}

/**
 * The queue, most overdue first. The API already orders it; the screen sorts again
 * because a row reviewed in this session must drop to the bottom without a reload.
 */
export function queueOrder(reviews: readonly BreakGlassReview[]): BreakGlassReview[] {
  return [...reviews].sort((left, right) => {
    if (left.reviewed_at === null && right.reviewed_at !== null) return -1
    if (left.reviewed_at !== null && right.reviewed_at === null) return 1
    return (left.first_exercised_at ?? '').localeCompare(right.first_exercised_at ?? '')
  })
}

export function overdueCount(reviews: readonly BreakGlassReview[]): number {
  return reviews.filter((review) => review.overdue).length
}

/** Said at the top, because a backlog of one reads differently from a backlog of nine. */
export function backlogSentence(reviews: readonly BreakGlassReview[]): string {
  const pending = reviews.filter((review) => review.reviewed_at === null).length
  if (pending === 0) return EMPTY_QUEUE
  const overdue = overdueCount(reviews)
  const cases = pending === 1 ? '1 caso espera revisión' : `${pending} casos esperan revisión`
  if (overdue === 0) return `${cases}, ninguno vencido.`
  return overdue === 1
    ? `${cases}, y 1 ya pasó de las 24 horas.`
    : `${cases}, y ${overdue} ya pasaron de las 24 horas.`
}

export function reviewMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Revisar un caso pide el deber «audit_break_glass», y además independencia: no revisa quien lo pidió, quien lo aprobó ni la persona cuyos datos se leyeron.',
    conflict: 'Este caso ya fue revisado. Una revisión es definitiva y no se reescribe.',
    'not-found': 'Ese caso no existe.',
    'validation-failed': 'El resultado de una revisión es justificado, no justificado o incidente.',
    'invalid-request': 'La petición no llevaba lo necesario para identificar la orden.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. El caso sigue sin revisar.',
    'network-unavailable': 'No hay conexión con el API. El caso sigue sin revisar.',
  }
  return messages[code] ?? 'No se pudo registrar la revisión.'
}

export function reviewOutcomeMessage(review: BreakGlassReview): string {
  if (review.review_outcome === null) return 'Caso revisado.'
  const late = review.reviewed_late === true ? ' Queda registrada como tardía.' : ''
  if (review.review_outcome === 'incident_opened') {
    return `Incidente abierto sobre este caso.${late}`
  }
  return `Caso registrado como ${outcomeLabel(review.review_outcome).toLowerCase()}.${late}`
}

function hoursSince(instant: string, now: Date): number {
  const parsed = Date.parse(instant)
  if (Number.isNaN(parsed)) return 0
  return Math.floor((now.getTime() - parsed) / 3_600_000)
}
