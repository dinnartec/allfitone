/**
 * The native half of the execution flow.
 *
 * `If-Match` carries the revision, which is where the optimistic lock lives on the
 * wire: it is a precondition on the resource, not a field of the body, and putting it
 * in the body would let a client send one number and mean another.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { ApiError, authorizedGet, authorizedPost, authorizedPut, refreshSession } from './index'
import {
  createExecutionFlow,
  type Abandoned,
  type Attempt,
  type Execution,
  type ExecutionFlow,
  type ExecutionSummary,
  type Finalized,
  type ResultsState,
  type Today,
} from './execution'
import { readSession, storeSession } from './session'
import { withRefresh } from './with-refresh'

export function createSpaceExecutionFlow(): ExecutionFlow {
  return createExecutionFlow({
    newCommand: () =>
      newCommand(
        { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
        Date.now(),
      ),
    transport: {
      readToday: (timezone) =>
        authenticated((token) =>
          authorizedGet<Today>(`/space/v1/today?timezone=${encodeURIComponent(timezone)}`, token),
        ),
      readExecution: (id) =>
        authenticated((token) => authorizedGet<Execution>(`/space/v1/executions/${id}`, token)),
      readSummary: (id, timezone) =>
        authenticated((token) =>
          authorizedGet<ExecutionSummary>(
            `/space/v1/executions/${id}/summary?timezone=${encodeURIComponent(timezone)}`,
            token,
          ),
        ),
      startAttempt: (command, plannedSessionId, start) =>
        authenticated((token) =>
          authorizedPost<Attempt>(
            `/space/v1/planned-sessions/${plannedSessionId}/attempts`,
            command,
            start,
            token,
          ),
        ),
      saveResults: (command, executedSessionId, revisionNumber, results) =>
        authenticated((token) =>
          authorizedPut<ResultsState>(
            `/space/v1/executions/${executedSessionId}/results`,
            command,
            results,
            token,
            revisionNumber,
          ),
        ),
      abandon: (command, executedSessionId, endedAt) =>
        authenticated((token) =>
          authorizedPost<Abandoned>(
            `/space/v1/executions/${executedSessionId}/abandonment`,
            command,
            { ended_at: endedAt },
            token,
          ),
        ),
      finish: (command, executedSessionId, endedAt) =>
        authenticated((token) =>
          authorizedPost<Finalized>(
            `/space/v1/executions/${executedSessionId}/finalize`,
            command,
            { ended_at: endedAt },
            token,
          ),
        ),
    },
  })
}

function authenticated<T>(send: (token: string | undefined) => Promise<T>): Promise<T> {
  return withRefresh(
    {
      session: async () => {
        const stored = await readSession()
        if (!stored) return null
        return { accessToken: stored.accessToken, refreshToken: stored.refreshToken }
      },
      persist: (tokens) => storeSession({ ...tokens, analytics: { distinct_id: null } }),
      refresh: async (refreshToken) => {
        const rotated = await refreshSession(refreshToken)
        return { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken }
      },
      unauthorized: (error) => error instanceof ApiError && error.failure === 'unauthenticated',
    },
    send,
  )
}
