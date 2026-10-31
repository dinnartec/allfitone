/**
 * What the person's plan opens, read from the functions `GET /pro` and `GET /pro/plans`
 * answer (DT-018). The database is what enforces every limit; this is only what the
 * screens say about them before anybody hits one, and the sheet that offers Pro when
 * somebody does.
 *
 * **A function the plan does not declare limits nothing**, as in the database: a plan
 * published before the function existed never promised a limit on it.
 */

import type { ProFeature } from './pro'

const find = (features: readonly ProFeature[], code: string) =>
  features.find((feature) => feature.code === code)

/** False only when the plan declares the function closed. */
export function opens(features: readonly ProFeature[], code: string): boolean {
  return find(features, code)?.enabled ?? true
}

/** The number the plan allows; null when it is unlimited or not limited at all. */
export function limitOf(features: readonly ProFeature[], code: string): number | null {
  const feature = find(features, code)
  return feature?.enabled ? feature.limit_value : null
}

/** The first visible day of a history window, in the phone's own day; null shows all. */
export function visibleFrom(
  features: readonly ProFeature[],
  code: string,
  now = new Date(),
): Date | null {
  const months = limitOf(features, code)
  if (months === null) return null
  return new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
}

// ———————————————————————————————————————— the sheet that offers Pro

const months = (count: number | null) =>
  count === 1 ? 'el último mes' : `los últimos ${String(count ?? 1)} meses`

const UPGRADE: Readonly<
  Record<string, (free: readonly ProFeature[]) => { title: string; body: string }>
> = {
  training_history_months: (free) => ({
    title: 'Todo tu historial, con Pro',
    body: `Con Gratis ves ${months(limitOf(free, 'training_history_months'))}. Lo anterior sigue guardado: con Pro lo vuelves a ver.`,
  }),
  nutrition_history_months: (free) => ({
    title: 'Todas tus comidas, con Pro',
    body: `Con Gratis ves ${months(limitOf(free, 'nutrition_history_months'))} de comidas. Lo anterior sigue guardado: con Pro lo vuelves a ver.`,
  }),
  active_personal_programs: (free) => ({
    title: 'Varios programas a la vez',
    body: `Con Gratis sigues ${String(limitOf(free, 'active_personal_programs') ?? 1)} programa propio a la vez. Con Pro, los que quieras. Los de tu gimnasio nunca cuentan.`,
  }),
  own_routines: (free) => ({
    title: 'Rutinas sin límite',
    body: `Con Gratis guardas hasta ${String(limitOf(free, 'own_routines') ?? 3)} rutinas propias. Con Pro, las que quieras: las que ya tienes se quedan.`,
  }),
  routine_duplication: () => ({
    title: 'Duplica tus rutinas',
    body: 'Con Pro copias una rutina tuya y la cambias sin tocar la original.',
  }),
  full_program_catalogue: () => ({
    title: 'Todo el catálogo de Allfit',
    body: 'Con Gratis tienes una selección para empezar. Con Pro, todos los programas según tu objetivo y tu nivel.',
  }),
  period_analysis: () => ({
    title: 'Compara tus periodos',
    body: 'Con Pro ves tus cargas, tu volumen y tu constancia semana a semana o mes a mes.',
  }),
  body_measurements: () => ({
    title: 'Todas tus medidas',
    body: 'Con Gratis registras tu peso y tu estatura. Con Pro, también cintura, brazo, grasa corporal y más.',
  }),
  body_photos: () => ({
    title: 'Fotos de tu progreso',
    body: 'Con Pro guardas fotos de tu cuerpo, solo para ti, y las comparas en el tiempo.',
  }),
  meal_photo_recognition: () => ({
    title: 'Registra con una foto',
    body: 'Con Pro tomas una foto de tu plato y la app reconoce lo que comes. Buscar alimentos sigue siendo gratis.',
  }),
}

/** What Pro opens for the function that was refused. */
export function upgradeCopy(
  code: string,
  free: readonly ProFeature[],
): { title: string; body: string } {
  return (
    UPGRADE[code]?.(free) ?? {
      title: 'Esto es parte de Pro',
      body: 'Tu plan no incluye esta función. Con Pro la tienes, junto con todo lo demás.',
    }
  )
}

// ———————————————————————————————————————— the comparison, side by side

export interface ComparisonRow {
  readonly key: string
  readonly label: string
  /** Text for the plan's value, or true for «included». */
  readonly free: string | true
  readonly pro: string | true
}

type Cell = (features: readonly ProFeature[]) => string | true

const historyWindow =
  (code: string): Cell =>
  (features) => {
    const limit = limitOf(features, code)
    if (!opens(features, code)) return 'No incluido'
    if (limit === null) return 'Completo'
    return limit === 1 ? 'Último mes' : `Últimos ${String(limit)} meses`
  }

const count =
  (code: string, unlimited: string, prefix = 'Hasta '): Cell =>
  (features) => {
    const limit = limitOf(features, code)
    if (!opens(features, code)) return 'No incluido'
    return limit === null ? unlimited : limit === 1 ? '1' : `${prefix}${String(limit)}`
  }

const either =
  (code: string, without: string, withIt: string): Cell =>
  (features) =>
    opens(features, code) ? withIt : without

const always: Cell = () => true

const ROWS: readonly (readonly [string, string, Cell])[] = [
  ['sessions', 'Sesiones, cargas y sin conexión', always],
  [
    'full_program_catalogue',
    'Programas de Allfit',
    either('full_program_catalogue', 'Selección básica', 'Catálogo completo'),
  ],
  ['training_history_months', 'Historial', historyWindow('training_history_months')],
  [
    'period_analysis',
    'Análisis',
    either('period_analysis', 'Resumen de la sesión', 'Cargas, volumen y constancia'),
  ],
  [
    'body_measurements',
    'Evolución corporal',
    (features) =>
      opens(features, 'body_photos')
        ? 'Medidas y fotos'
        : opens(features, 'body_measurements')
          ? 'Medidas'
          : 'Peso',
  ],
  [
    'meal_photo_recognition',
    'Nutrición',
    either('meal_photo_recognition', 'Registro y metas', 'Registro, metas y fotos con IA'),
  ],
  ['nutrition_history_months', 'Historial de comidas', historyWindow('nutrition_history_months')],
  [
    'active_personal_programs',
    'Programas propios activos',
    count('active_personal_programs', 'Sin límite', ''),
  ],
  ['own_routines', 'Rutinas propias', count('own_routines', 'Sin límite')],
  [
    'routine_duplication',
    'Duplicar rutinas',
    (features) => (opens(features, 'routine_duplication') ? true : 'No incluido'),
  ],
  ['organization', 'Programas de tu gimnasio', always],
  ['privacy', 'Privacidad y tus datos', always],
]

/** Every row of the table, from what each plan declares. */
export function comparisonRows(
  free: readonly ProFeature[],
  pro: readonly ProFeature[],
): ComparisonRow[] {
  return ROWS.map(([key, label, cell]) => ({ key, label, free: cell(free), pro: cell(pro) }))
}
