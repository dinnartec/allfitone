/**
 * The native half of the Pro flow: the fetches, behind the same refresh the other flows use.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost } from './index'
import {
  createProFlow,
  type ProFlow,
  type ProPayments,
  type ProPlanCatalogue,
  type ProStatus,
} from './pro'
import { authenticated } from './session'

export function createSpaceProFlow(): ProFlow {
  return createProFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      read: () => authenticated((token) => authorizedGet<ProStatus>('/space/v1/pro', token)),
      plans: () =>
        authenticated((token) => authorizedGet<ProPlanCatalogue>('/space/v1/pro/plans', token)),
      payments: () =>
        authenticated((token) => authorizedGet<ProPayments>('/space/v1/pro/payments', token)),
      purchase: (command, purchase) =>
        authenticated((token) =>
          authorizedPost<ProStatus>('/space/v1/pro/purchases', command, purchase, token),
        ),
    },
  })
}
