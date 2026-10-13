/**
 * What the profile tab (`PF-1`) says about the person, worked out without a screen.
 *
 * The profile is an index: each row names a part of the account and, under it, the one
 * fact that tells the person whether to open it. Those facts come from what the API
 * already answers — the name from the training profile, the plan from `GET /pro` — and
 * a row with nothing true to say says what it holds instead of inventing a number.
 */

import { gymsOf, storeName, subscriptionOf, type ProStatus } from './pro'

/** Up to two initials, from the name the person gave; none when there is no name. */
export function initialsOf(name: string): string | undefined {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return undefined
  return words
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('')
}

/** The plan row's caption: which plan, and who pays for it. */
export function planCaption(status: ProStatus): string {
  const subscription = subscriptionOf(status)
  if (status.effective_source === 'subscription' && subscription) {
    return `Pro · pagado con ${storeName(subscription.store)}`
  }
  if (status.effective_source === 'organization' && gymsOf(status).length > 0) {
    return 'Pro · incluido por tu gimnasio'
  }
  return 'Gratis · sin costo'
}

/** The payments row's caption, which must not suggest a charge where there is none. */
export function paymentsCaption(status: ProStatus): string {
  const subscription = subscriptionOf(status)
  if (status.effective_source === 'organization' && !subscription) {
    return 'Sin pagos: tu plan viene del gimnasio'
  }
  return subscription
    ? `Tus cobros de Allfit Pro con ${storeName(subscription.store)}`
    : 'Tus cobros de Allfit Pro'
}
