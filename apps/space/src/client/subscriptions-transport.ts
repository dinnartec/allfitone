/**
 * The native half of the subscription flow: the stored session, the bearer header and
 * `expo-crypto`.
 *
 * Split from `subscriptions.ts` for the same reason the programs flow is split — that
 * file has to stay loadable by the test runner, and none of this does.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost } from './index'
import { authenticated } from './session'
import {
  createSubscriptionFlow,
  type PlanOfferPage,
  type RelationshipPage,
  type SubscriptionCheckout,
  type SubscriptionFlow,
  type SubscriptionList,
  type SubscriptionTransition,
} from './subscriptions'

export function createSpaceSubscriptionFlow(): SubscriptionFlow {
  return createSubscriptionFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      readMyRelationships: () =>
        authenticated((token) =>
          authorizedGet<RelationshipPage>('/space/v1/relationships?limit=100', token),
        ),
      readPlans: (organizationId) =>
        authenticated((token) =>
          authorizedGet<PlanOfferPage>(
            `/space/v1/organizations/${organizationId}/plans?limit=100`,
            token,
          ),
        ),
      readMySubscriptions: () =>
        authenticated((token) => authorizedGet<SubscriptionList>('/space/v1/subscriptions', token)),
      subscribe: (command, planVersionId) =>
        authenticated((token) =>
          authorizedPost<SubscriptionCheckout>(
            '/space/v1/subscriptions',
            command,
            { plan_version_id: planVersionId },
            token,
          ),
        ),
      // No body: the subscription is in the path, and there is nothing to choose. The API
      // hashes the path so one key cannot cancel two.
      cancel: (command, subscriptionId) =>
        authenticated((token) =>
          authorizedPost<SubscriptionTransition>(
            `/space/v1/subscriptions/${subscriptionId}/cancellation`,
            command,
            undefined,
            token,
          ),
        ),
    },
  })
}
