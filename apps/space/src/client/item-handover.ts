/**
 * One item handed from the capture to its own screen and back (R-F4, R-A3).
 *
 * The item is edited on a screen of its own, not in a sheet: a sheet lifted by the
 * keyboard stayed afloat on device. The capture keeps the meal; this carries the one item
 * across and its outcome back, taken once when the capture is in view again, as the saved
 * meal is handed to the diary.
 *
 * Editing keeps every change as it happens, so leaving by the back gesture loses nothing.
 * A food picked from the search is added only when the person says so.
 */

import type { CaptureItem } from './capture'
import type { GoalTarget } from './nutrition'

export interface OpenedItem {
  readonly item: CaptureItem
  readonly targets: readonly GoalTarget[]
  /** `edit` an item of the meal, or `add` a food picked from the search. */
  readonly mode: 'edit' | 'add'
  readonly mealName: string
}

export type ItemOutcome =
  | { readonly kind: 'kept'; readonly item: CaptureItem }
  | { readonly kind: 'added'; readonly item: CaptureItem }
  | { readonly kind: 'removed'; readonly key: string }
  | { readonly kind: 'change-food'; readonly item: CaptureItem }

let opened: OpenedItem | null = null
let outcome: ItemOutcome | null = null

export function openItem(item: OpenedItem): void {
  opened = item
  outcome = null
}

/** What the item screen shows; read, not taken, since the screen renders more than once. */
export const openedItem = (): OpenedItem | null => opened

/** A change while editing; one to a food not yet added is the screen's alone. */
export function keepItem(item: CaptureItem): void {
  if (opened?.mode === 'edit') outcome = { kind: 'kept', item }
}

/** How the screen was closed on purpose: added, removed, or off to choose another food. */
export function settleItem(result: ItemOutcome): void {
  outcome = result
}

export function takeItemOutcome(): ItemOutcome | null {
  const taken = outcome
  outcome = null
  return taken
}
