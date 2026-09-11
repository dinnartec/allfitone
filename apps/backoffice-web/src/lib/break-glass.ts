/**
 * Presentation rules for break-glass windows.
 *
 * This is the most consequential screen in the product, so the copy carries
 * weight the schema cannot. Three things it has to make true:
 *
 * The tier is shown as a *consequence*, never as a choice. An operator picks
 * categories; the tier, the number of approvers and the minutes follow. Showing
 * them as fields would invite someone to look for the cheap combination.
 *
 * A forbidden category is not offered at all. Not greyed out, not marked
 * "requires more approvals" — absent. An option that can never be granted is a
 * suggestion to try.
 *
 * And a window says how long it has left, because fifteen minutes is short and
 * "approved" alone does not tell an operator to hurry.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BreakGlassRequest = AllfitV1Schemas['BreakGlassRequest']
export type BreakGlassCategory = AllfitV1Schemas['BreakGlassCategory']
export type BreakGlassPurpose = AllfitV1Schemas['BreakGlassPurpose']
export type BreakGlassStatus = AllfitV1Schemas['BreakGlassStatus']
export type BreakGlassTier = AllfitV1Schemas['BreakGlassTier']
export type BreakGlassExerciseOutcome = AllfitV1Schemas['BreakGlassExerciseOutcome']

/** Only what can be approved. The forbidden set is absent, not disabled. */
export const BREAK_GLASS_CATEGORIES: readonly BreakGlassCategory[] = [
  'relationship_training',
  'prior_training_history',
  'nutrition_guidance',
  'body_progress',
  'health_context',
  'nutrition_intake',
]

const CATEGORY_LABELS: Record<BreakGlassCategory, string> = {
  relationship_training: 'Entrenamiento de la relación',
  prior_training_history: 'Historial previo de entrenamiento',
  nutrition_guidance: 'Guía nutricional',
  body_progress: 'Progreso corporal',
  health_context: 'Contexto de salud',
  nutrition_intake: 'Ingesta nutricional',
}

export function categoryLabel(category: BreakGlassCategory): string {
  return CATEGORY_LABELS[category]
}

export const BREAK_GLASS_PURPOSES: readonly BreakGlassPurpose[] = [
  'service_dispute',
  'legal_or_regulatory_obligation',
  'customer_support_request',
  'security_investigation',
  'authorized_quality_review',
]

const PURPOSE_LABELS: Record<BreakGlassPurpose, string> = {
  service_dispute: 'Disputa del servicio',
  legal_or_regulatory_obligation: 'Obligación legal o regulatoria',
  customer_support_request: 'La persona pidió soporte',
  security_investigation: 'Investigación de seguridad',
  authorized_quality_review: 'Revisión de calidad autorizada',
}

export function purposeLabel(purpose: BreakGlassPurpose): string {
  return PURPOSE_LABELS[purpose]
}

export const BREAK_GLASS_STATUSES: readonly BreakGlassStatus[] = [
  'requested',
  'approved',
  'rejected',
  'closed',
  'expired',
]

const STATUS_LABELS: Record<BreakGlassStatus, string> = {
  requested: 'Esperando aprobación',
  approved: 'Ventana abierta',
  rejected: 'Rechazada',
  closed: 'Cerrada',
  expired: 'Vencida',
}

export function statusLabel(status: BreakGlassStatus): string {
  return STATUS_LABELS[status]
}

export type StatusTone = 'success' | 'warning' | 'secondary' | 'destructive'

export function statusTone(status: BreakGlassStatus): StatusTone {
  if (status === 'approved') return 'success'
  if (status === 'requested') return 'warning'
  if (status === 'rejected') return 'destructive'
  return 'secondary'
}

/**
 * The tier a scope will get, computed the same way the server does so the
 * operator sees the consequence before committing. The server remains the
 * authority: this never travels in the request.
 */
export function projectedTier(categories: readonly BreakGlassCategory[]): BreakGlassTier | null {
  if (categories.length === 0) return null
  const restricted: readonly BreakGlassCategory[] = [
    'body_progress',
    'health_context',
    'nutrition_intake',
  ]
  return categories.some((category) => restricted.includes(category)) ? 'restricted' : 'standard'
}

export interface TierConsequence {
  tier: BreakGlassTier
  approvals: number
  minutes: number
  sentence: string
}

export function tierConsequence(categories: readonly BreakGlassCategory[]): TierConsequence | null {
  const tier = projectedTier(categories)
  if (!tier) return null
  if (tier === 'restricted') {
    return {
      tier,
      approvals: 2,
      minutes: 15,
      sentence:
        'Alcance restringido: hacen falta dos personas distintas y la ventana dura 15 minutos.',
    }
  }
  return {
    tier,
    approvals: 1,
    minutes: 30,
    sentence: 'Alcance estándar: hace falta una aprobación y la ventana dura 30 minutos.',
  }
}

export function tierLabel(tier: BreakGlassTier): string {
  return tier === 'restricted' ? 'Restringido' : 'Estándar'
}

const CASE_REFERENCE = /^[A-Z][A-Z0-9_-]{2,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidCaseReference(value: string): boolean {
  return CASE_REFERENCE.test(value.trim())
}

export function isValidSubject(value: string): boolean {
  return UUID.test(value.trim())
}

export type RequestIssue = 'subject' | 'case' | 'categories'

export function requestIssue(draft: {
  subject: string
  caseReference: string
  categories: readonly BreakGlassCategory[]
}): RequestIssue | undefined {
  if (!isValidSubject(draft.subject)) return 'subject'
  if (!isValidCaseReference(draft.caseReference)) return 'case'
  if (draft.categories.length === 0) return 'categories'
  return undefined
}

const REQUEST_MESSAGES: Record<RequestIssue, string> = {
  subject: 'Escribe el identificador de la persona cuyos datos vas a abrir.',
  case: 'La referencia del caso va en mayúsculas, como CASE-2026-001.',
  categories: 'Elige al menos una categoría: no existe acceso a «toda la cuenta».',
}

export function requestIssueMessage(issue: RequestIssue): string {
  return REQUEST_MESSAGES[issue]
}

/**
 * How much of the window is left. Fifteen minutes is short, and "approved" on its
 * own does not tell an operator to hurry.
 */
export function remainingMinutes(file: BreakGlassRequest, now = Date.now()): number | null {
  if (file.status !== 'approved' || !file.window_ends_at) return null
  return Math.max(0, Math.ceil((Date.parse(file.window_ends_at) - now) / 60_000))
}

export function windowSentence(file: BreakGlassRequest, now = Date.now()): string | null {
  const left = remainingMinutes(file, now)
  if (left === null) return null
  if (left === 0) return 'La ventana ya venció. Ninguna lectura entrega contenido.'
  return `Quedan ${left} ${left === 1 ? 'minuto' : 'minutos'} de ventana. No se puede extender.`
}

export function approvalsSoFar(file: BreakGlassRequest): number {
  return file.approvals.filter((approval) => approval.decision === 'approved').length
}

/** What the tray shows about how far a pending request is from opening. */
export function quorumSentence(file: BreakGlassRequest): string {
  if (file.status !== 'requested') return ''
  const so_far = approvalsSoFar(file)
  const missing = file.required_approvals - so_far
  if (missing <= 0) return 'Quórum completo.'
  return `${so_far} de ${file.required_approvals} aprobaciones. Faltan ${missing}.`
}

/**
 * Whether this operator may decide, and whether they may exercise.
 *
 * Both come from the server. The rule — an approver is never the requester, never
 * the subject and never somebody who already decided — is the same one the
 * database trigger enforces, and re-deriving it here would be a second copy that
 * drifts. They are hints that save offering a button that would always be
 * refused; every command revalidates on its own.
 */
export function canDecide(file: BreakGlassRequest): boolean {
  return file.viewer_can_decide
}

export function canExercise(file: BreakGlassRequest): boolean {
  return file.viewer_can_exercise
}

const OUTCOME_MESSAGES: Record<string, string> = {
  not_the_requester: 'Sólo quien pidió la ventana puede ejercerla.',
  duty_not_effective: 'Tu deber ya no está vigente. Quedó registrado el intento.',
  window_not_open: 'La ventana no está abierta: venció, se cerró o aún no fue aprobada.',
  quorum_incomplete: 'Falta una aprobación para que la ventana se abra.',
  category_out_of_scope: 'Esa categoría no está dentro del alcance aprobado.',
  execution_and_nutrition_absent:
    'La ventana es válida y el intento quedó registrado, pero el contenido todavía no existe en la plataforma.',
}

/**
 * Every outcome is explained, including the authorised one, because an operator
 * who reads "no hay contenido" without context will assume the window failed.
 */
export function outcomeMessage(outcome: BreakGlassExerciseOutcome): string {
  return (
    OUTCOME_MESSAGES[outcome.reason_code] ?? 'El intento quedó registrado y no entregó contenido.'
  )
}

export function breakGlassMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber que esta operación exige. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    conflict:
      'El expediente ya no admite esta acción: una solicitud rechazada no se aprueba, y una ventana cerrada no se reabre. Para continuar, pide otra.',
    'not-found': 'Ese expediente no existe.',
    'validation-failed':
      'La solicitud no cumple el contrato. Revisa la persona, el caso y las categorías.',
    'invalid-request': 'Falta un identificador de comando. Vuelve a intentarlo.',
    'idempotency-in-progress': 'El comando anterior sigue procesándose. Reintenta en un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo completar la operación.'
}
