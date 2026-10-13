/**
 * Allfit Pro on Space: `OP-PAY-018..020` and `OP-PAY-023` (ADR-043).
 *
 * The store charges and the store verifies; this domain records what was verified and
 * resolves, on every read, which plan decides a person's limits. Who owns a subscription,
 * which version it froze and what a late notification may change are decided in
 * PostgreSQL. The shapes here only let a malformed request be refused before it travels.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { Store, StoreSubscriptionState } from '@allfitone/store-billing'

import type { PaymentsCommandContext, PaymentsCommandResult } from './index.js'

export type ProStatus = AllfitV1Schemas['SpaceProStatus']
export type ProPlanCatalogue = AllfitV1Schemas['SpaceProPlanCatalogue']
export type ProPurchaseRequest = AllfitV1Schemas['SpaceProPurchase']

export const STORE_PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._]{0,99}$/
export const MAX_SIGNED_TRANSACTION = 20_000
export const MAX_PURCHASE_TOKEN = 4_096

export type NotificationOutcome = 'processed' | 'ignored' | 'stale' | 'replayed'

export interface ProReader {
  personId: string
  requestId: string
}

export interface ProDatabase {
  read(input: ProReader): Promise<ProStatus>
  plans(input: ProReader): Promise<ProPlanCatalogue>
  recordPurchase(
    input: ProReader & PaymentsCommandContext & { state: StoreSubscriptionState },
  ): Promise<PaymentsCommandResult<ProStatus>>
  applyNotification(input: {
    store: Store
    notificationId: string
    payloadHash: Uint8Array
    state: StoreSubscriptionState
    requestId: string
  }): Promise<NotificationOutcome>
}
