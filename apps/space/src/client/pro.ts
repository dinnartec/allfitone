/**
 * Allfit Pro on the phone: `HU-SP-084..088` (ADR-043), the pure half.
 *
 * The API resolves Pro and the store charges for it; what lives here is what the screens
 * say about that, and the one command the app sends. Keeping the wording out of the
 * screens is what lets it be tested: which source decides, when the paid period ends,
 * whether paying would only stop depending on a gym.
 *
 * **A purchase is presented once per purchase.** The command is held by the purchase's
 * own token, so the retry after a dropped connection — or the same purchase coming back
 * from a restore — reuses it, and the server answers the same subscription.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'
import type { IconName } from '@allfitone/icons'

export type ProStatus = AllfitV1Schemas['SpaceProStatus']
export type ProPlanCatalogue = AllfitV1Schemas['SpaceProPlanCatalogue']
export type ProPlan = AllfitV1Schemas['SpaceProPlan']
export type ProPayments = AllfitV1Schemas['SpaceProPayments']
export type ProPayment = AllfitV1Schemas['SpaceProPayment']
export type ProPurchase = AllfitV1Schemas['SpaceProPurchase']
export type ProSource = AllfitV1Schemas['SpaceProSource']
export type ProFeature = AllfitV1Schemas['SpaceProFeature']
export type ProStore = AllfitV1Schemas['SpaceProStore']

export type SubscriptionSource = Extract<ProSource, { kind: 'subscription' }>
export type OrganizationSource = Extract<ProSource, { kind: 'organization' }>

export interface ProTransport {
  read(): Promise<ProStatus>
  plans(): Promise<ProPlanCatalogue>
  payments(): Promise<ProPayments>
  purchase(command: CommandHeaders, purchase: ProPurchase): Promise<ProStatus>
}

export interface ProFlow {
  read(): Promise<ProStatus>
  plans(): Promise<ProPlanCatalogue>
  payments(): Promise<ProPayments>
  /** Presents a purchase the store finished; the same purchase reuses its command. */
  present(purchase: ProPurchase): Promise<ProStatus>
}

const purchaseKey = (purchase: ProPurchase) =>
  purchase.store === 'app_store' ? purchase.signed_transaction : purchase.purchase_token

export function createProFlow(dependencies: {
  readonly transport: ProTransport
  readonly newCommand: () => CommandHeaders
}): ProFlow {
  const { transport, newCommand } = dependencies
  const held = new Map<string, CommandHeaders>()

  return {
    read: () => transport.read(),
    plans: () => transport.plans(),
    payments: () => transport.payments(),
    async present(purchase) {
      const key = purchaseKey(purchase)
      const command = held.get(key) ?? newCommand()
      held.set(key, command)
      const answer = await transport.purchase(command, purchase)
      held.delete(key)
      return answer
    },
  }
}

// ———————————————————————————————————————— what the screens say

const STORE_NAME: Record<ProStore, string> = { app_store: 'Apple', google_play: 'Google Play' }
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export const storeName = (store: ProStore) => STORE_NAME[store]

/** «3 oct», in the phone's own time zone. */
export function shortDate(instant: string): string {
  const date = new Date(instant)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

export const subscriptionOf = (status: ProStatus): SubscriptionSource | undefined =>
  status.sources.find((source): source is SubscriptionSource => source.kind === 'subscription')

export const gymsOf = (status: ProStatus): OrganizationSource[] =>
  status.sources.filter((source): source is OrganizationSource => source.kind === 'organization')

/** The line under the plan's name: who pays for it, or that nobody does. */
export function sourceLine(status: ProStatus): string {
  const subscription = subscriptionOf(status)
  const [gym] = gymsOf(status)
  if (status.effective_source === 'subscription' && subscription) {
    return `Pagado con ${storeName(subscription.store)}`
  }
  if (status.effective_source === 'organization' && gym)
    return `Incluido por ${gym.organization_name}`
  return 'Sin costo, para siempre'
}

/** What happens at the end of the paid period, in one line. */
export function renewalLine(subscription: SubscriptionSource): string {
  if (subscription.status === 'grace' && subscription.grace_until) {
    return `No pudimos renovar: sigues con Pro hasta el ${shortDate(subscription.grace_until)}`
  }
  if (subscription.status === 'suspended') return 'Cobro pendiente: Pro está en pausa'
  const day = shortDate(subscription.current_period_end)
  return subscription.auto_renews ? `Renueva el ${day}` : `Termina el ${day}, no se renueva`
}

/** `HU-SP-085` criterion 6: said before charging, never after. */
export function gymWarning(status: ProStatus): string | undefined {
  if (status.effective_source !== 'organization') return undefined
  const [gym] = gymsOf(status)
  if (!gym) return undefined
  return `Ya tienes Pro por ${gym.organization_name}. Pagarlo solo te sirve para no depender de esa afiliación.`
}

export const WAITING_FOR_FEATURES = 'Muy pronto verás aquí cada función de Pro y su límite.'

const historySentence = (what: string) => (limit: number | null) =>
  limit === null
    ? `Todo tu ${what}`
    : limit === 1
      ? `${what.charAt(0).toUpperCase()}${what.slice(1)} del último mes`
      : `${what.charAt(0).toUpperCase()}${what.slice(1)} de los últimos ${String(limit)} meses`

// What each known function says at a given limit; `null` is unlimited.
const SENTENCES: Readonly<Record<string, (limit: number | null) => string>> = {
  active_personal_programs: (limit) =>
    limit === null
      ? 'Programas propios sin límite'
      : `Máximo ${String(limit)} ${limit === 1 ? 'programa propio activo' : 'programas propios activos'}`,
  own_routines: (limit) =>
    limit === null
      ? 'Rutinas propias sin límite'
      : `Máximo ${String(limit)} ${limit === 1 ? 'rutina propia' : 'rutinas propias'}`,
  training_history_months: historySentence('historial'),
  nutrition_history_months: historySentence('historial de comidas'),
  routine_duplication: () => 'Duplicar rutinas',
  full_program_catalogue: () => 'Todo el catálogo de programas',
  period_analysis: () => 'Comparar tus periodos',
  body_measurements: () => 'Todas tus medidas',
  body_photos: () => 'Fotos de tu progreso',
  meal_photo_recognition: () => 'Comidas por foto con IA',
}

// When a function is left out of a plan, what the person still has instead. A function
// with nothing in its place is not listed: «Lo que incluye» names only what is included.
const WITHOUT: Readonly<Record<string, string>> = {
  full_program_catalogue: 'Una selección de programas',
  period_analysis: 'Resumen de cada sesión',
  body_measurements: 'Peso y estatura',
  meal_photo_recognition: 'Comidas por búsqueda de alimentos',
}

/** One function as a sentence; undefined for one the plan leaves out with nothing instead. */
export function featureSentence(feature: ProFeature): string | undefined {
  if (!feature.enabled) return WITHOUT[feature.code]
  const sentence = SENTENCES[feature.code]
  if (sentence) return sentence(feature.limit_value)
  return feature.limit_value === null
    ? `${feature.name} sin límite`
    : `${feature.name}: máximo ${feature.limit_value}`
}

const FEATURE_ICONS: Readonly<Record<string, IconName>> = {
  active_personal_programs: 'training',
  own_routines: 'checklist',
  routine_duplication: 'duplicate',
  full_program_catalogue: 'explore',
  training_history_months: 'history',
  nutrition_history_months: 'nutrition',
  period_analysis: 'progress',
  body_measurements: 'weight',
  body_photos: 'image',
  meal_photo_recognition: 'camera',
}

/** The icon of a function; one the app does not know yet gets a neutral mark. */
export const featureIcon = (code: string): IconName => FEATURE_ICONS[code] ?? 'check'

const MINOR_DIGITS: Readonly<Record<string, number>> = { CLP: 0, JPY: 0, KRW: 0, PYG: 0 }

/** «$24.900» in pesos, «$9,99 USD» elsewhere: what a receipt says, not a ledger. */
export function money(amountMinor: number | null, currency: string | null): string | undefined {
  if (amountMinor === null || !currency) return undefined
  const digits = MINOR_DIGITS[currency] ?? 2
  const whole = Math.floor(amountMinor / 10 ** digits)
  const cents = amountMinor % 10 ** digits
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const amount = cents === 0 ? `$${grouped}` : `$${grouped},${String(cents).padStart(digits, '0')}`
  return currency === 'COP' ? amount : `${amount} ${currency}`
}

/** The latest charge that went through, to show what the person pays. */
export const lastPaid = (payments: readonly ProPayment[]): ProPayment | undefined =>
  payments.find((payment) => payment.result === 'succeeded')

const PERIODS: Readonly<Record<string, { readonly fee: string; readonly per: string }>> = {
  month: { fee: 'Cuota mensual', per: '/mes' },
  year: { fee: 'Cuota anual', per: '/año' },
}

/** How a version is billed, read from the catalogue rather than assumed to be monthly. */
export function billingOf(
  catalogue: ProPlanCatalogue | undefined,
  versionId: string,
): { readonly fee: string; readonly per: string } {
  const period = catalogue?.plans.find((plan) => plan.version_id === versionId)?.billing_period
  return (period ? PERIODS[period] : undefined) ?? { fee: 'Cuota', per: '' }
}

export const proPlanOf = (catalogue: ProPlanCatalogue): ProPlan | undefined =>
  catalogue.plans.find((plan) => plan.code === 'pro')

export const freePlanOf = (catalogue: ProPlanCatalogue): ProPlan | undefined =>
  catalogue.plans.find((plan) => plan.kind === 'free')

/** The product that sells Pro in this phone's store, if Allfit sells it there. */
export function productFor(plan: ProPlan, store: ProStore): string | undefined {
  return plan.store_products.find((product) => product.store === store)?.product_id
}
