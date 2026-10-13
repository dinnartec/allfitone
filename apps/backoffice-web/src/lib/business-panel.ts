/**
 * `HU-BO-004` — presentation rules for how the business is going.
 *
 * Three statements must never look alike on this screen. **A figure** is a count
 * the platform stands behind. **Too small to publish** means there are people
 * behind it but not enough for the number to be safe to say. **Not modelled yet**
 * means Allfit has no table for it at all. Only the first is a number; the other
 * two are blank with a reason, because a zero would be read as "the business is
 * at zero" rather than "we cannot answer".
 *
 * Every figure is shown with the period it was measured over, and a figure whose
 * period is missing is not shown at all: it would be a number the reader would
 * date themselves.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatAmount } from './platform-plans'

export type SupportBusinessPanel = AllfitV1Schemas['SupportBusinessPanel']
export type SupportBusinessMoneyMetric = AllfitV1Schemas['SupportBusinessMoneyMetric']
export type SupportBusinessMetric = AllfitV1Schemas['SupportBusinessMetric']
export type SupportBusinessMetricKey = AllfitV1Schemas['SupportBusinessMetricKey']
export type SupportBusinessMetricPeriod = AllfitV1Schemas['SupportBusinessMetricPeriod']

export type BusinessSectionKey = 'people' | 'organizations' | 'money' | 'other'

export interface BusinessSection {
  key: BusinessSectionKey
  title: string
  description: string
  metrics: SupportBusinessMetric[]
}

const SECTION_ORDER: BusinessSectionKey[] = ['people', 'organizations', 'money', 'other']

const SECTIONS: Record<BusinessSectionKey, { title: string; description: string }> = {
  people: {
    title: 'Personas',
    description: 'Cuántas se han registrado y cuántas se movieron en la última semana.',
  },
  organizations: {
    title: 'Gimnasios',
    description: 'Cuántos existen y cuántos operan de verdad.',
  },
  money: {
    title: 'Dinero',
    description: 'Suscripciones, facturación y Premium.',
  },
  other: {
    title: 'Otras cifras',
    description: 'Indicadores que el API empezó a publicar después de esta pantalla.',
  },
}

const METRIC_SECTIONS: Record<string, BusinessSectionKey> = {
  registered_people: 'people',
  new_people_this_week: 'people',
  active_people_this_week: 'people',
  studio_active_professionals_this_week: 'people',
  organizations: 'organizations',
  operating_organizations: 'organizations',
  unclaimed_organizations: 'organizations',
  active_subscriptions: 'money',
  active_organization_subscriptions: 'money',
  pro_people_paying_allfit: 'money',
  pro_people_through_organization: 'money',
  premium_people: 'money',
}

const METRIC_LABELS: Record<string, string> = {
  registered_people: 'Personas registradas',
  new_people_this_week: 'Personas nuevas',
  active_people_this_week: 'Personas activas entrenando',
  studio_active_professionals_this_week: 'Profesionales activos en Studio',
  organizations: 'Gimnasios creados',
  operating_organizations: 'Gimnasios operando',
  unclaimed_organizations: 'Gimnasios sin reclamar',
  active_subscriptions: 'Suscripciones de Pro',
  active_organization_subscriptions: 'Planes de gimnasio activos',
  pro_people_paying_allfit: 'Con Pro, pagándole a Allfit',
  pro_people_through_organization: 'Con Pro, por su gimnasio',
  premium_people: 'Personas con Pro',
  billed_this_month: 'Facturado',
}

const METRIC_HINTS: Record<string, string> = {
  registered_people: 'Cuentas abiertas que siguen abiertas. Quien cerró la suya no cuenta.',
  new_people_this_week: 'Cuentas abiertas dentro de la ventana, no personas que volvieron.',
  active_people_this_week:
    'Quien entrenó dentro de la ventana, contado una vez por más veces que haya entrenado. Abrir la aplicación no es estar activo.',
  studio_active_professionals_this_week:
    'Profesionales que trabajaron en Studio. Es otra pregunta que la de arriba y no sustituye a la anterior.',
  organizations: 'Todos, sin importar en qué estado estén.',
  operating_organizations: 'Reclamados, no cerrados y con al menos una persona en el equipo.',
  unclaimed_organizations: 'Allfit los creó y su dueño todavía no los aceptó.',
  active_subscriptions: 'Lo que Allfit cobra por Pro a través de las tiendas.',
  active_organization_subscriptions:
    'Lo que las personas le pagan a su gimnasio. El gimnasio lo cobra en su propia pasarela: no es ingreso de Allfit y no pasa por aquí.',
  pro_people_paying_allfit: 'Compraron Pro en App Store o Google Play.',
  pro_people_through_organization:
    'Lo tienen por entrenar en un gimnasio que opera. Quien además le paga a Allfit se cuenta arriba y no aquí.',
  premium_people: 'Las dos rutas sumadas, cada persona una sola vez.',
  billed_this_month:
    'Lo que las tiendas reportaron como cobrado. Un cobro fallido no cuenta, y cada moneda va aparte.',
}

const REASONS: Record<string, string> = {
  payments_not_modelled:
    'Allfit todavía no guarda pagos ni suscripciones. Cuando existan, esta cifra aparece aquí.',
}

export const NOT_MODELLED_NOTE = 'Allfit todavía no guarda los datos para esta cifra.'

export const NOTHING_BILLED = 'Nada cobrado todavía este mes.'

/**
 * What Allfit billed, one line per currency. They are never added together: a total
 * mixing pesos and dollars would be a number that means nothing, and the API sends them
 * apart for that reason.
 */
export function moneyLines(metric: SupportBusinessMoneyMetric): string[] {
  if (metric.availability !== 'available' || metric.amounts === null) return []
  if (metric.amounts.length === 0) return [NOTHING_BILLED]
  return metric.amounts.map((amount) => formatAmount(amount.amount_minor, amount.currency_code))
}

export function moneyNote(metric: SupportBusinessMoneyMetric, minimum: number): string | null {
  if (metric.availability === 'available') return null
  if (metric.availability === 'below_threshold') {
    return `Menos de ${minimum} personas pagaron. No se publica el monto porque con tan pocas se puede deducir lo que paga cada una.`
  }
  return (metric.reason ? REASONS[metric.reason] : null) ?? NOT_MODELLED_NOTE
}

/** The metrics, in the order the API published them, grouped by what they answer. */
export function businessSections(panel: SupportBusinessPanel): BusinessSection[] {
  const grouped = new Map<BusinessSectionKey, SupportBusinessMetric[]>()
  for (const metric of panel.metrics) {
    // A figure without a period is not shown: it would be a number the reader dates.
    if (!metric.period?.kind || !metric.period.to) continue
    const section = METRIC_SECTIONS[metric.key] ?? 'other'
    grouped.set(section, [...(grouped.get(section) ?? []), metric])
  }
  return SECTION_ORDER.filter((key) => (grouped.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    title: SECTIONS[key].title,
    description: SECTIONS[key].description,
    metrics: grouped.get(key) ?? [],
  }))
}

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key
}

export function metricHint(key: string): string | null {
  return METRIC_HINTS[key] ?? null
}

/** The figure, or a dash: a figure that cannot be given is never drawn as zero. */
export function metricValue(metric: SupportBusinessMetric): string {
  if (metric.availability !== 'available' || metric.value === null) return '—'
  return new Intl.NumberFormat('es-CO').format(metric.value)
}

export function metricNote(metric: SupportBusinessMetric, minimum: number): string | null {
  if (metric.availability === 'available') return null
  if (metric.availability === 'below_threshold') {
    return `Menos de ${minimum} personas. No se publica para que ninguna cifra pueda señalar a alguien.`
  }
  return (metric.reason ? REASONS[metric.reason] : null) ?? NOT_MODELLED_NOTE
}

/** What a badge should say about a figure, which is never "cero". */
export function metricBadge(metric: SupportBusinessMetric): {
  label: string
  variant: 'secondary' | 'success'
} {
  if (metric.availability === 'available') return { label: 'Medido', variant: 'success' }
  if (metric.availability === 'below_threshold') {
    return { label: 'Grupo muy pequeño', variant: 'secondary' }
  }
  return { label: 'Sin datos aún', variant: 'secondary' }
}

/** Every figure says of what period it is, in words rather than two timestamps. */
export function periodPhrase(period: SupportBusinessMetricPeriod): string {
  const to = formatDay(period.to)
  if (period.kind === 'total') return `Total hasta ${to}`
  const from = formatDay(period.from)
  if (period.kind === 'week') return `Del ${from} al ${to}`
  return `Desde ${from} hasta ${to}`
}

function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(parsed))
}

export function businessMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ver cómo va el negocio pide el deber «view_platform_metrics». Los deberes vencen por diseño, así que puede que el tuyo ya no esté vigente.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer cómo va el negocio.'
}
