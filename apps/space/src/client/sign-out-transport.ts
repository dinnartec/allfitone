/**
 * The native half of signing out: the stored session, and what the phone is holding.
 *
 * Split from `sign-out.ts` for the reason every flow here is split — that file has to
 * stay loadable by the test runner, and none of this does.
 *
 * **No renewal.** Every other authenticated call goes through the session keeper,
 * which renews a stale token; this one must not. Refreshing in order to
 * revoke would mint a new session on the way out, and a stale token is already a
 * session `OP-IDN-048` concedes closing.
 */

import { readSession, clearSession } from './session'
import { authorizedGet, revokeSpaceSession } from './index'
import { createSignOutFlow, type SignOutFlow } from './sign-out'
import type { WeekPlan } from './programs'

export function createSpaceSignOutFlow(): SignOutFlow {
  return createSignOutFlow({
    transport: {
      revoke: async () => {
        const stored = await readSession()
        await revokeSpaceSession(stored?.accessToken)
      },
    },
    clearSession,
    openExecutionId: async () => {
      const stored = await readSession()
      if (!stored) return null
      // The zone only decides which week is read, and an open attempt is in whichever
      // week it started; the device's own is the honest one to ask with.
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const plan = await authorizedGet<WeekPlan>(
        `/space/v1/week-plan?timezone=${encodeURIComponent(zone)}`,
        stored.accessToken,
      )
      return (
        plan.sessions.find((session) => session.open_execution_id !== null)?.open_execution_id ??
        null
      )
    },
  })
}
