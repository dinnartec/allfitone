/**
 * The native half of «Lo que compartes»: the stored session, the bearer header and
 * `expo-crypto`. Split from `sharing.ts` so that file stays loadable by the test runner.
 *
 * One command per grant until it is answered, so a retry after a dropped connection is
 * the same revocation and reads back as a replay rather than as a conflict.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import { newCommand, type CommandHeaders } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost } from './index'
import { authenticated } from './session'
import type { Consent } from './sharing'

type ConsentList = AllfitV1Schemas['SpaceConsentList']
type ConsentRevocation = AllfitV1Schemas['ConsentRevocation']

const pending = new Map<string, CommandHeaders>()

const command = () =>
  newCommand(
    { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
    Date.now(),
  )

export const consents = {
  list: async (): Promise<readonly Consent[]> =>
    (await authenticated((token) => authorizedGet<ConsentList>('/space/v1/consents', token))).data,

  async revoke(grantId: string): Promise<ConsentRevocation> {
    const held = pending.get(grantId) ?? command()
    pending.set(grantId, held)
    const result = await authenticated((token) =>
      authorizedPost<ConsentRevocation>(
        `/space/v1/consents/${grantId}/revocation`,
        held,
        undefined,
        token,
      ),
    )
    pending.delete(grantId)
    return result
  },
}
