/**
 * The native half of «Progreso»: the comparison, for everything or for one programme,
 * behind the same refresh the other flows use.
 */

import { authorizedGet } from './index'
import type { PeriodComparison, PeriodKind } from './progress'
import { authenticated } from './session'

/** `program` is an assignment id, `free`, or null for everything. */
export function comparePeriods(
  period: PeriodKind,
  count: number,
  timezone: string,
  program: string | null = null,
): Promise<PeriodComparison> {
  const query =
    `timezone=${encodeURIComponent(timezone)}&period=${period}&count=${String(count)}` +
    (program ? `&program=${encodeURIComponent(program)}` : '')
  return authenticated((token) =>
    authorizedGet<PeriodComparison>(`/space/v1/progress/periods?${query}`, token),
  )
}
