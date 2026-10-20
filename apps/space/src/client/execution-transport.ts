/**
 * The native half of the execution flow.
 *
 * `If-Match` carries the revision, which is where the optimistic lock lives on the
 * wire: it is a precondition on the resource, not a field of the body, and putting it
 * in the body would let a client send one number and mean another.
 */

import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost, authorizedPut } from './index'
import {
  createExecutionFlow,
  type Abandoned,
  type Attempt,
  type FreeSession,
  type Execution,
  type ExecutionFlow,
  type ExecutionSummary,
  type Finalized,
  type FinishedExecution,
  type Invalidated,
  type InvalidationPreview,
  type Repeated,
  type ResultsState,
  type Revised,
  type Today,
} from './execution'
import { historyPath, type HistoryMonth, type HistoryPage } from './history'
import { authenticated } from './session'

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
      listHistory: (filters) =>
        authenticated((token) => authorizedGet<HistoryPage>(historyPath(filters), token)),
      readHistoryMonth: (month, timezone) =>
        authenticated((token) =>
          authorizedGet<HistoryMonth>(
            `/space/v1/history/months/${month}?timezone=${encodeURIComponent(timezone)}`,
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
      startFreeSession: (command, start) =>
        authenticated((token) =>
          authorizedPost<FreeSession>('/space/v1/executions', command, start, token),
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
      readFinished: (id, timezone) =>
        authenticated((token) =>
          authorizedGet<FinishedExecution>(
            `/space/v1/executions/${id}/detail?timezone=${encodeURIComponent(timezone)}`,
            token,
          ),
        ),
      readAnnulmentPreview: (id, timezone) =>
        authenticated((token) =>
          authorizedGet<InvalidationPreview>(
            `/space/v1/executions/${id}/invalidation-preview?timezone=${encodeURIComponent(timezone)}`,
            token,
          ),
        ),
      revise: (command, executedSessionId, revisionNumber, revision) =>
        authenticated((token) =>
          authorizedPost<Revised>(
            `/space/v1/executions/${executedSessionId}/revisions`,
            command,
            revision,
            token,
            String(revisionNumber),
          ),
        ),
      annul: (command, executedSessionId) =>
        authenticated((token) =>
          authorizedPost<Invalidated>(
            `/space/v1/executions/${executedSessionId}/invalidation`,
            command,
            {},
            token,
          ),
        ),
      repeat: (command, executedSessionId, start) =>
        authenticated((token) =>
          authorizedPost<Repeated>(
            `/space/v1/executions/${executedSessionId}/repetitions`,
            command,
            start,
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
