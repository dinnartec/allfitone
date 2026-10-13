import { expect, test } from 'bun:test'
import {
  StoreBillingError,
  type StoreBilling,
  type StoreSubscriptionState,
} from '@allfitone/store-billing'

import type { ProDatabase, ProStatus } from '../domain/pro.js'
import { createProService } from './pro.js'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const reader = { personId: PERSON, requestId: '019f1000-0000-7000-8000-000000000999' }
const command = {
  idempotencyKey: '51111111-1111-4111-8111-111111111111',
  commandId: '019f1000-0000-7000-8000-000000000201',
  requestHash: new Uint8Array(32),
}

const state: StoreSubscriptionState = {
  store: 'app_store',
  environment: 'sandbox',
  productId: 'allfit.pro.monthly.v1',
  subscriptionRef: '2000000000000001',
  transactionId: '2000000000000001',
  accountToken: PERSON,
  status: 'active',
  endedReason: null,
  autoRenews: true,
  currentPeriodEnd: new Date('2026-11-12T12:00:00Z'),
  graceUntil: null,
  observedAt: new Date('2026-10-12T12:00:00Z'),
  amountMinor: 1_990_000,
  currencyCode: 'COP',
}

function fakes(billing: Partial<StoreBilling>) {
  const recorded: unknown[] = []
  const database: ProDatabase = {
    read: async () => ({}) as ProStatus,
    plans: async () => ({ generated_at: '', plans: [] }),
    payments: async () => ({ generated_at: '', payments: [] }),
    recordPurchase: async (input) => {
      recorded.push(input)
      return { resource: {} as ProStatus, replayed: false }
    },
    applyNotification: async (input) => {
      recorded.push(input)
      return 'processed'
    },
  }
  const store: StoreBilling = {
    verifyPurchase: async () => state,
    verifyAppStoreNotification: async () => ({
      store: 'app_store',
      notificationId: 'n-1',
      payloadHash: new Uint8Array(32),
      state,
    }),
    verifyGooglePlayNotification: async () => ({
      store: 'google_play',
      notificationId: 'm-1',
      payloadHash: new Uint8Array(32),
      state: null,
    }),
    ...billing,
  }
  return { service: createProService(database, () => store), recorded }
}

test('T-PAY-PRO-UNIT-22 a purchase is recorded only as the state the store verified', async () => {
  const { service, recorded } = fakes({})
  await service.purchase(reader, { store: 'app_store', signed_transaction: 'jws' }, command)
  expect(recorded).toEqual([{ ...reader, ...command, state }])
})

test('T-PAY-PRO-UNIT-23 a purchase the store refuses never reaches the database', async () => {
  const { service, recorded } = fakes({
    verifyPurchase: async () => {
      throw new StoreBillingError('invalid')
    },
  })
  await expect(
    service.purchase(
      reader,
      { store: 'google_play', product_id: 'allfit.pro.monthly.v1', purchase_token: 'token' },
      command,
    ),
  ).rejects.toMatchObject({ failure: 'invalid' })
  expect(recorded).toEqual([])
})

test('T-PAY-PRO-UNIT-24 a notification about a subscription is applied; one without is ignored here', async () => {
  const { service, recorded } = fakes({})
  expect(await service.appStoreNotification('jws', 'request')).toBe('processed')
  expect(await service.googlePlayNotification('Bearer oidc', '{}', 'request')).toBe('ignored')
  expect(recorded).toHaveLength(1)
})
