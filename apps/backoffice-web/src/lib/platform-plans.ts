/**
 * `HU-BO-025`, `HU-BO-026` — presentation rules for the plans Allfit sells.
 *
 * Three things this module refuses to blur. **A proposal is not a version in force**:
 * nothing changes for anybody until somebody else publishes it, so the screen always
 * shows the two apart and says who can publish. **A limit is not a feature**: a
 * function can be left out, included without limit, or included up to a number, and
 * each reads differently. **A price is minor units in a currency**: the operator types
 * pesos and the API receives cents, and a thousands separator is refused rather than
 * guessed, because "39.900" means two different amounts depending on who wrote it.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type PlatformPlanCatalogue = AllfitV1Schemas['PlatformPlanCatalogue']
export type PlatformPlan = AllfitV1Schemas['PlatformPlan']
export type PlatformPlanVersion = AllfitV1Schemas['PlatformPlanVersion']
export type PlatformPlanVersionChange = AllfitV1Schemas['PlatformPlanVersionChange']
export type PlatformPlanVersionProposal = AllfitV1Schemas['PlatformPlanVersionProposal']
export type PlatformPlanFeatureLimit = AllfitV1Schemas['PlatformPlanFeatureLimit']
export type PlatformFeature = AllfitV1Schemas['PlatformFeature']
export type PlatformPlanKind = AllfitV1Schemas['PlatformPlanKind']
export type PlatformPlanBillingPeriod = AllfitV1Schemas['PlatformPlanBillingPeriod']

const PLAN_CODE = /^[a-z][a-z0-9_]{1,39}$/
const MAX_PLAN_NAME = 80
const MAX_AMOUNT_MINOR = 100_000_000_000
const MAX_LIMIT = 2_147_483_647

/** The currencies the form offers, with how many minor units each has (ISO 4217). */
export const PLAN_CURRENCIES = [
  { code: 'COP', label: 'Pesos colombianos (COP)', exponent: 2 },
  { code: 'USD', label: 'Dólares (USD)', exponent: 2 },
] as const

export const BILLING_PERIOD_OPTIONS: { value: PlatformPlanBillingPeriod; label: string }[] = [
  { value: 'month', label: 'Mensual' },
  { value: 'year', label: 'Anual' },
]

export const PLAN_KIND_OPTIONS: { value: PlatformPlanKind; label: string }[] = [
  { value: 'free', label: 'Gratis' },
  { value: 'paid', label: 'De pago' },
]

const VERSION_STATUS: Record<PlatformPlanVersion['status'], { label: string; tone: Tone }> = {
  draft: { label: 'En revisión', tone: 'warning' },
  published: { label: 'En vigor', tone: 'success' },
  deprecated: { label: 'Reemplazada', tone: 'secondary' },
  archived: { label: 'Retirada', tone: 'secondary' },
}

const UNITS: Record<string, [one: string, many: string]> = {
  items: ['registro', 'registros'],
  weeks: ['semana', 'semanas'],
  days: ['día', 'días'],
  months: ['mes', 'meses'],
}

export type Tone = 'success' | 'warning' | 'secondary'

export function planKindLabel(kind: PlatformPlanKind): string {
  return kind === 'free' ? 'Gratis' : 'De pago'
}

export function planStatusLabel(status: PlatformPlan['status']): string {
  return status === 'published' ? 'Publicado' : 'Sin versión en vigor'
}

export function versionStatus(status: PlatformPlanVersion['status']): {
  label: string
  tone: Tone
} {
  return VERSION_STATUS[status]
}

export function isValidPlanCode(value: string): boolean {
  return PLAN_CODE.test(value.trim())
}

export function isValidPlanName(value: string): boolean {
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_PLAN_NAME
}

export function hasFreePlan(catalogue: PlatformPlanCatalogue): boolean {
  return catalogue.plans.some((plan) => plan.plan_kind === 'free')
}

function exponentOf(currency: string | null): number {
  return PLAN_CURRENCIES.find((option) => option.code === currency)?.exponent ?? 2
}

/** What the closed selector says. The code alone is not a currency to a reader. */
export function currencyLabel(currency: string): string {
  return PLAN_CURRENCIES.find((option) => option.code === currency)?.label ?? currency
}

/**
 * What the operator typed, in minor units, or undefined when it is not a price. Digits
 * and at most one decimal comma; a dot is refused because it could be either separator.
 */
export function parsePriceToMinor(text: string, currency: string): number | undefined {
  const value = text.trim()
  const exponent = exponentOf(currency)
  const shape = new RegExp(`^(\\d{1,12})(?:,(\\d{1,${exponent}}))?$`)
  const match = shape.exec(value)
  if (!match) return undefined
  const [, units = '0', fraction = ''] = match
  const minor = Number(units) * 10 ** exponent + Number(fraction.padEnd(exponent, '0'))
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_AMOUNT_MINOR) return undefined
  return minor
}

export function priceIssue(): string {
  return 'Escribe el precio sin puntos de miles; si lleva centavos, van después de una coma. Por ejemplo 39900 o 9,99.'
}

export function formatPrice(
  version: Pick<PlatformPlanVersion, 'amount_minor' | 'currency_code' | 'billing_period'>,
): string {
  if (version.amount_minor === 0 || version.currency_code === null) return 'Gratis'
  const amount = formatAmount(version.amount_minor, version.currency_code)
  const period = version.billing_period === 'year' ? 'al año' : 'al mes'
  return `${amount} ${period}`
}

function formatAmount(amountMinor: number, currency: string): string {
  const exponent = exponentOf(currency)
  const whole = amountMinor % 10 ** exponent === 0
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: whole ? 0 : exponent,
    maximumFractionDigits: whole ? 0 : exponent,
  }).format(amountMinor / 10 ** exponent)
}

/** A function's state in a version, in words. Never a bare number. */
export function limitPhrase(
  state: { enabled: boolean; limit_value: number | null } | null,
  unit: string | null,
): string {
  if (!state || !state.enabled) return 'No incluida'
  if (state.limit_value === null) return 'Sin límite'
  const [one, many] = (unit ? UNITS[unit] : undefined) ?? [unit ?? '', unit ?? '']
  const noun = state.limit_value === 1 ? one : many
  return `Hasta ${state.limit_value}${noun ? ` ${noun}` : ''}`
}

export function featureName(catalogue: PlatformPlanCatalogue, code: string | null): string {
  if (!code) return 'Función'
  return catalogue.feature_catalog.find((feature) => feature.code === code)?.name ?? code
}

function featureUnit(catalogue: PlatformPlanCatalogue, code: string | null): string | null {
  return catalogue.feature_catalog.find((feature) => feature.code === code)?.unit ?? null
}

function isFeatureState(value: unknown): value is { enabled: boolean; limit_value: number | null } {
  return typeof value === 'object' && value !== null && 'enabled' in value
}

/**
 * One line per difference, written against the version in force. The reviewer reads
 * this, not two versions side by side.
 */
export function changeLines(
  catalogue: PlatformPlanCatalogue,
  proposal: PlatformPlanVersion,
  inForce: PlatformPlanVersion | null,
): string[] {
  if (proposal.changes === null || !inForce) {
    return ['Primera versión del plan: todavía no hay nada en vigor con qué compararla.']
  }
  return proposal.changes.map((change) => {
    if (change.field === 'amount_minor') {
      return `Precio: ${formatPrice(inForce)} → ${formatPrice(proposal)}`
    }
    if (change.field === 'currency_code') {
      return `Moneda: ${String(change.before ?? 'ninguna')} → ${String(change.after ?? 'ninguna')}`
    }
    if (change.field === 'billing_period') {
      return `Cobro: ${periodLabel(change.before)} → ${periodLabel(change.after)}`
    }
    const unit = featureUnit(catalogue, change.feature_code)
    const before = isFeatureState(change.before) ? change.before : null
    const after = isFeatureState(change.after) ? change.after : null
    return `${featureName(catalogue, change.feature_code)}: ${limitPhrase(before, unit)} → ${limitPhrase(after, unit)}`
  })
}

function periodLabel(value: unknown): string {
  if (value === 'month') return 'mensual'
  if (value === 'year') return 'anual'
  return 'sin periodo'
}

/** Who may act on a proposal, said before the button is pressed rather than after. */
export function reviewNote(proposal: PlatformPlanVersion): string {
  if (proposal.proposed_by_self) {
    return 'Tú la propusiste, así que la publica otra persona del equipo con el deber comercial. Puedes retirarla si cambiaste de idea.'
  }
  return 'La propuso otra persona. Revisa qué cambia: si estás de acuerdo, publícala; si no, retírala. Publicarla no cambia nada a quien ya está suscrito: conserva la versión que aceptó.'
}

export interface FeatureDraft {
  code: string
  enabled: boolean
  limit: string
}

export function initialFeatureDrafts(
  catalogue: PlatformPlanCatalogue,
  inForce: PlatformPlanVersion | null,
): FeatureDraft[] {
  return catalogue.feature_catalog.map((feature) => {
    const current = inForce?.features.find((entry) => entry.feature_code === feature.code)
    return {
      code: feature.code,
      enabled: current?.enabled ?? false,
      limit:
        current?.limit_value === null || current?.limit_value === undefined
          ? ''
          : String(current.limit_value),
    }
  })
}

/** The declared limits, or the first function whose limit is not a whole number. */
export function featureLimits(
  drafts: FeatureDraft[],
): { limits: PlatformPlanFeatureLimit[] } | { invalid: string } {
  const limits: PlatformPlanFeatureLimit[] = []
  for (const draft of drafts) {
    const text = draft.limit.trim()
    if (!draft.enabled) {
      limits.push({ feature_code: draft.code, enabled: false, limit_value: null })
      continue
    }
    if (text === '') {
      limits.push({ feature_code: draft.code, enabled: true, limit_value: null })
      continue
    }
    if (!/^\d{1,10}$/.test(text) || Number(text) > MAX_LIMIT) return { invalid: draft.code }
    limits.push({ feature_code: draft.code, enabled: true, limit_value: Number(text) })
  }
  return { limits }
}

export function plansMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Los planes de Allfit piden el deber «manage_platform_commercial». Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudieron leer los planes.'
}

export type PlanAction = 'create' | 'propose' | 'publish' | 'withdraw'

export function planCommandMessage(action: PlanAction, code: string): string {
  if (code === 'conflict') {
    if (action === 'create') {
      return 'Ese código ya existe, o ya hay un plan gratuito: sus límites cambian publicando versiones, no creando otro plan.'
    }
    if (action === 'propose') {
      return 'Este plan ya tiene una propuesta abierta, o la propuesta no cambia nada respecto de la versión en vigor.'
    }
    return 'Esa propuesta ya no está abierta. La lista se actualizó.'
  }
  if (code === 'forbidden' && action === 'publish') {
    return 'No puedes publicar una propuesta tuya: la publica otra persona. Si no es tuya, tu deber comercial ya no está vigente.'
  }
  if (code === 'validation-failed' && action === 'propose') {
    return 'El servidor rechazó la propuesta. El plan gratuito cuesta cero y no lleva moneda ni periodo; uno de pago lleva precio, moneda y periodo; y cada función del catálogo aparece una vez.'
  }
  const messages: Record<string, string> = {
    'validation-failed': 'Revisa el código, el nombre y el tipo del plan.',
    'not-found': 'Ese plan o esa versión ya no existe. La lista se actualizó.',
    'idempotency-in-progress': 'La acción anterior todavía se está procesando. Espera un momento.',
    forbidden: plansMessage('forbidden'),
    unauthenticated: plansMessage('unauthenticated'),
    'network-unavailable': plansMessage('network-unavailable'),
  }
  return messages[code] ?? 'No se pudo completar la acción.'
}

export function planOutcomeMessage(action: PlanAction, plan: PlatformPlan): string {
  if (action === 'create') {
    return `Se creó «${plan.name}». Todavía no ofrece nada: su primera versión se propone aquí y la publica otra persona.`
  }
  if (action === 'propose') {
    return `Se propuso la versión ${plan.proposal?.version_number ?? ''} de «${plan.name}». Nada cambia hasta que otra persona la publique.`
  }
  if (action === 'publish') {
    return `«${plan.name}» tiene en vigor la versión ${plan.current_version?.version_number ?? ''}. Quien ya estaba suscrito conserva la suya.`
  }
  return `Se retiró la propuesta de «${plan.name}». Queda en el historial con quién la retiró.`
}
