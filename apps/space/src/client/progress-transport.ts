/**
 * The native half of «Progreso»: the comparison and the two history months its line
 * adds up, behind the same refresh the other flows use.
 */

import { authorizedGet } from './index'
import type { HistoryMonth } from './history'
import type { PeriodComparison, PeriodKind } from './progress'
import { authenticated } from './session'

export function comparePeriods(
  period: PeriodKind,
  count: number,
  timezone: string,
): Promise<PeriodComparison> {
  const query = `timezone=${encodeURIComponent(timezone)}&period=${period}&count=${String(count)}`
  return authenticated((token) =>
    authorizedGet<PeriodComparison>(`/space/v1/progress/periods?${query}`, token),
  )
}

export function readHistoryMonth(month: string, timezone: string): Promise<HistoryMonth> {
  return authenticated((token) =>
    authorizedGet<HistoryMonth>(
      `/space/v1/history/months/${month}?timezone=${encodeURIComponent(timezone)}`,
      token,
    ),
  )
}
