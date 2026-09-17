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
 *
 * What an allowed read returns is shown as the person recorded it, beside the value the
 * platform normalized, and a photo is only ever a flag: the reference never reaches here.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BreakGlassRequest = AllfitV1Schemas['BreakGlassRequest']
export type BreakGlassCategory = AllfitV1Schemas['BreakGlassCategory']
export type BreakGlassPurpose = AllfitV1Schemas['BreakGlassPurpose']
export type BreakGlassStatus = AllfitV1Schemas['BreakGlassStatus']
export type BreakGlassTier = AllfitV1Schemas['BreakGlassTier']
export type BreakGlassExerciseOutcome = AllfitV1Schemas['BreakGlassExerciseOutcome']
export type BodyProgressRecord = AllfitV1Schemas['BodyProgressRecord']
type ExecutionDetail = AllfitV1Schemas['ExecutionDetail']
type BodyProgressMetricCode = AllfitV1Schemas['BodyProgressMetricCode']
type BodyProgressUnitCode = AllfitV1Schemas['BodyProgressUnitCode']
type HealthContextType = AllfitV1Schemas['HealthContextType']
type HealthContextBodyArea = AllfitV1Schemas['HealthContextBodyArea']
type Provenance = AllfitV1Schemas['Provenance']
type MealType = AllfitV1Schemas['MealType']
type NutrientCode = AllfitV1Schemas['NutrientCode']
type ExecutionStatus = AllfitV1Schemas['ExecutionStatus']
type ExecutionValidationStatus = AllfitV1Schemas['ExecutionValidationStatus']
type CompletenessLevel = AllfitV1Schemas['CompletenessLevel']

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

// The evidence records what was opened, so each category names its own table. The
// server refuses a category that returns content when it is pointed at another one.
const CATEGORY_RESOURCES: Record<BreakGlassCategory, string> = {
  relationship_training: 'execution.executed_sessions',
  prior_training_history: 'execution.executed_sessions',
  nutrition_guidance: 'nutrition.goal_versions',
  body_progress: 'identity.body_progress_records',
  health_context: 'identity.health_context_claims',
  nutrition_intake: 'nutrition.meals',
}

export function resourceTypeFor(category: BreakGlassCategory): string {
  return CATEGORY_RESOURCES[category]
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

export function canExercise(file: BreakGlassRequest, now = Date.now()): boolean {
  if (!file.viewer_can_exercise) return false
  // The hint was true when the server answered it. A window that has lapsed since
  // delivers nothing, so the screen stops offering the read on its own rather than
  // waiting for the operator to discover it by clicking.
  const left = remainingMinutes(file, now)
  return left === null || left > 0
}

const OUTCOME_MESSAGES: Record<string, string> = {
  not_the_requester: 'Sólo quien pidió la ventana puede ejercerla.',
  duty_not_effective: 'Tu deber ya no está vigente. Quedó registrado el intento.',
  window_not_open: 'La ventana no está abierta: venció, se cerró o aún no fue aprobada.',
  quorum_incomplete: 'Falta una aprobación para que la ventana se abra.',
  category_out_of_scope: 'Esa categoría no está dentro del alcance aprobado.',
  resource_out_of_scope:
    'Esa lectura no corresponde a la categoría aprobada. Quedó registrado el intento.',
  authorized_exercise:
    'Lectura autorizada. Es lo que la persona tiene registrado ahora y deja de verse cuando la ventana cierra.',
  category_content_absent:
    'La ventana es válida y el intento quedó registrado, pero esa categoría todavía no guarda contenido en la plataforma.',
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

const METRIC_LABELS: Record<BodyProgressMetricCode, string> = {
  weight: 'Peso',
  muscle_mass: 'Masa muscular',
  body_fat: 'Grasa corporal',
  waist: 'Cintura',
  hip: 'Cadera',
  chest: 'Pecho',
  arm: 'Brazo',
  thigh: 'Muslo',
}

const UNIT_SYMBOLS: Record<BodyProgressUnitCode, string> = {
  kg: 'kg',
  lb: 'lb',
  m: 'm',
  cm: 'cm',
  in: 'in',
  percent: '%',
}

export interface MeasurementRow {
  id: string
  metric: string
  recorded: string
  normalized: string
  measuredOn: string
  photo: string
}

/** The measurements an allowed read returned, newest first as the server sent them. */
export function measurementRows(outcome: BreakGlassExerciseOutcome): MeasurementRow[] {
  if (outcome.outcome !== 'allowed') return []
  return (outcome.content?.body_progress ?? []).map((record) => ({
    id: record.id,
    metric: METRIC_LABELS[record.metric_code],
    // No original means the person already typed the canonical unit.
    recorded:
      record.original_value === null || record.original_unit_code === null
        ? quantity(record.value, record.unit_code)
        : quantity(record.original_value, record.original_unit_code),
    normalized: quantity(record.value, record.unit_code),
    measuredOn: calendarDay(record.measured_on),
    photo: record.has_media ? 'Tiene foto; no se muestra aquí' : 'Sin foto',
  }))
}

function quantity(value: number, unit: BodyProgressUnitCode): string {
  const amount = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value)
  return `${amount} ${UNIT_SYMBOLS[unit]}`
}

function calendarDay(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed)) return value
  // Read and shown in UTC, so the day never shifts with the operator's time zone.
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'UTC' }).format(parsed)
}

const CONTEXT_TYPE_LABELS: Record<HealthContextType, string> = {
  pain: 'Dolor',
  limitation: 'Limitación',
  recovery: 'Recuperación',
}

const BODY_AREA_LABELS: Record<HealthContextBodyArea, string> = {
  neck: 'Cuello',
  shoulder: 'Hombro',
  upper_back: 'Espalda alta',
  lower_back: 'Espalda baja',
  chest: 'Pecho',
  abdomen: 'Abdomen',
  arm: 'Brazo',
  elbow: 'Codo',
  wrist_hand: 'Muñeca o mano',
  hip: 'Cadera',
  thigh: 'Muslo',
  knee: 'Rodilla',
  lower_leg: 'Pierna',
  ankle_foot: 'Tobillo o pie',
}

// Who said it matters as much as what was said: a declaration is not an observation.
const PROVENANCE_LABELS: Record<Provenance, string> = {
  person_declared: 'Lo declaró la persona',
  professional_observation: 'Lo observó un profesional',
  device_observed: 'Lo midió un dispositivo',
  system_inferred: 'Lo infirió el sistema',
  authority_verified: 'Lo verificó una autoridad',
}

export interface HealthContextRow {
  id: string
  type: string
  description: string
  area: string
  since: string
  until: string
  provenance: string
}

/** The claims an allowed read returned, most recent start first as the server sent them. */
export function healthContextRows(outcome: BreakGlassExerciseOutcome): HealthContextRow[] {
  if (outcome.outcome !== 'allowed') return []
  return (outcome.content?.health_context ?? []).map((claim) => ({
    id: claim.id,
    type: CONTEXT_TYPE_LABELS[claim.context_type],
    description: claim.description,
    area: claim.body_area === null ? 'Sin zona indicada' : BODY_AREA_LABELS[claim.body_area],
    since: formatDay(claim.valid_from),
    until: claim.valid_to === null ? 'Sin fecha de fin' : formatDay(claim.valid_to),
    provenance: PROVENANCE_LABELS[claim.provenance],
  }))
}

/** The day a claim starts or ends, in the operator's zone; the hour adds nothing to it. */
export function formatDay(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(parsed)
}

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
  snack: 'Merienda',
  other: 'Otra comida',
}

// Totals are shown in this order, each after its amount.
const NUTRIENT_TOTALS: readonly [NutrientCode, string][] = [
  ['energy', 'kcal'],
  ['protein', 'g de proteína'],
  ['carbohydrates', 'g de carbohidratos'],
  ['fat', 'g de grasa'],
  ['fiber', 'g de fibra'],
  ['water', 'ml de agua'],
]

export interface MealRow {
  id: string
  when: string
  type: string
  eaten: string
  totals: string
  note: string
  photo: string
}

/** The meals an allowed read returned, most recent first as the server sent them. */
export function mealRows(outcome: BreakGlassExerciseOutcome): MealRow[] {
  if (outcome.outcome !== 'allowed') return []
  return (outcome.content?.nutrition_intake ?? []).map((meal) => {
    const zone = String(meal.timezone)
    const sums = new Map<NutrientCode, number>()
    for (const item of meal.items) {
      for (const nutrient of item.nutrients) {
        sums.set(nutrient.nutrient_code, (sums.get(nutrient.nutrient_code) ?? 0) + nutrient.value)
      }
    }
    const totals = NUTRIENT_TOTALS.filter(([code]) => sums.has(code)).map(
      ([code, label]) => `${amount(sums.get(code) ?? 0)} ${label}`,
    )
    return {
      id: meal.id,
      // The hour where it was eaten, and the zone that makes that hour true.
      when: `${mealMoment(meal.occurred_at, zone)} · ${zone}`,
      type: MEAL_TYPE_LABELS[meal.meal_type],
      eaten: [...meal.items]
        .sort((left, right) => left.position - right.position)
        .map((item) =>
          item.quantity === null || item.quantity_unit === null
            ? item.name
            : `${item.name}, ${amount(item.quantity)} ${item.quantity_unit}`,
        )
        .join(' · '),
      totals: totals.length > 0 ? totals.join(' · ') : 'Sin valores registrados',
      note: meal.note ?? 'Sin nota',
      photo: meal.has_media ? 'Tiene foto; no se muestra aquí' : 'Sin foto',
    }
  })
}

function amount(value: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value)
}

function mealMoment(value: string, zone: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: zone,
    }).format(parsed)
  } catch {
    // A zone this browser does not know still gets a date, in the operator's own zone.
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
      parsed,
    )
  }
}

/** An allowed read that returned nothing still has to say what it looked for. */

const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  in_progress: 'En curso',
  paused: 'En pausa',
  completed: 'Completada',
  abandoned: 'Abandonada',
}

const VALIDATION_LABELS: Record<ExecutionValidationStatus, string> = {
  pending: 'sin validar',
  valid: 'validada',
  invalid: 'invalidada',
  annulled: 'anulada',
}

const LEVEL_LABELS: Record<CompletenessLevel, string> = {
  partial: 'Parcial',
  summary: 'Resumen',
  detailed: 'Detallado',
  sensor_enriched: 'Con sensores',
}

export interface TrainingRow {
  id: string
  when: string
  activity: string
  duration: string
  done: string
  state: string
  level: string
}

/** The sessions an allowed read returned, most recent first as the server sent them. */
export function trainingRows(outcome: BreakGlassExerciseOutcome): TrainingRow[] {
  if (outcome.outcome !== 'allowed') return []
  return (outcome.content?.prior_training_history ?? []).map((session) => {
    const zone = String(session.timezone)
    return {
      id: session.id,
      // The hour where it was trained, and the zone that makes that hour true.
      when: `${mealMoment(session.started_at, zone)} · ${zone}`,
      activity: session.activity_type_name,
      duration: sessionLength(session.started_at, session.ended_at),
      done: whatWasDone(session.strength_sets, session.endurance_laps),
      state: `${EXECUTION_STATUS_LABELS[session.status]} · ${VALIDATION_LABELS[session.validation_status]}`,
      level:
        session.achieved_level === null
          ? 'Sin nivel certificado'
          : LEVEL_LABELS[session.achieved_level],
    }
  })
}

function sessionLength(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return 'Sin cerrar'
  const span = Date.parse(endedAt) - Date.parse(startedAt)
  if (Number.isNaN(span) || span < 0) return '—'
  const minutes = Math.round(span / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** What the session held, summed the way a reviewer reads it rather than set by set. */
function whatWasDone(
  sets: ExecutionDetail['strength_sets'],
  laps: ExecutionDetail['endurance_laps'],
): string {
  const parts: string[] = []
  if (sets.length > 0) {
    const reps = sets.reduce((total, set) => total + (set.achieved_reps ?? 0), 0)
    parts.push(`${sets.length} ${sets.length === 1 ? 'serie' : 'series'}`)
    if (reps > 0) parts.push(`${reps} ${reps === 1 ? 'repetición' : 'repeticiones'}`)
    const heaviest = heaviestByUnit(sets)
    if (heaviest) parts.push(`hasta ${heaviest}`)
  }
  if (laps.length > 0) {
    const seconds = laps.reduce((total, lap) => total + lap.duration_seconds, 0)
    parts.push(`${laps.length} ${laps.length === 1 ? 'tramo' : 'tramos'}`)
    parts.push(coveredByUnit(laps))
    parts.push(clock(seconds))
  }
  return parts.length > 0 ? parts.join(' · ') : 'Sin resultados registrados'
}

/** Loads in different units are never added together; each unit keeps its own top. */
function heaviestByUnit(sets: ExecutionDetail['strength_sets']): string {
  const tops = new Map<string, number>()
  for (const set of sets) {
    if (!set.load) continue
    tops.set(set.load.unit, Math.max(tops.get(set.load.unit) ?? 0, set.load.value))
  }
  return [...tops].map(([unit, value]) => `${amount(value)} ${unit}`).join(' y ')
}

function coveredByUnit(laps: ExecutionDetail['endurance_laps']): string {
  const totals = new Map<string, number>()
  for (const lap of laps) {
    totals.set(lap.distance.unit, (totals.get(lap.distance.unit) ?? 0) + lap.distance.value)
  }
  return [...totals].map(([unit, value]) => `${amount(value)} ${unit}`).join(' y ')
}

function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export function emptyReadMessage(category: BreakGlassCategory | undefined): string {
  if (category === 'body_progress') return 'La persona no tiene mediciones registradas.'
  if (category === 'health_context') {
    return 'La persona no ha declarado dolores, limitaciones ni recuperaciones.'
  }
  if (category === 'nutrition_intake') return 'La persona no ha registrado comidas.'
  if (category === 'prior_training_history') {
    return 'La persona no tiene sesiones de entrenamiento registradas.'
  }
  return 'La lectura no devolvió registros.'
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
