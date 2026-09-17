/**
 * Session use cases for Space.
 *
 * The token is carried through, never interpreted: its subject is resolved to a person inside
 * each command's own transaction, so this layer cannot record or finish for anyone else.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'

import type {
  ExecutionCommand,
  ExecutionDatabase,
  ExecutionDetail,
  ExecutionFinalized,
  ExecutionListInput,
  ExecutionPage,
  ExecutionResult,
  ExecutionResultsReplace,
  ExecutionResultsState,
  FreeExecutionCreate,
  FreeExecutionStarted,
} from '../domain/sessions.js'

export interface ExecutionService {
  start(
    token: VerifiedToken,
    input: Omit<ExecutionCommand, 'requestId'> & {
      sessionId: string
      session: FreeExecutionCreate
    },
  ): Promise<ExecutionResult<FreeExecutionStarted>>
  replaceResults(
    token: VerifiedToken,
    input: Omit<ExecutionCommand, 'requestId'> & {
      sessionId: string
      expectedRevision: number
      results: ExecutionResultsReplace
    },
  ): Promise<ExecutionResult<ExecutionResultsState>>
  finalize(
    token: VerifiedToken,
    input: Omit<ExecutionCommand, 'requestId'> & {
      sessionId: string
      expectedRevision: number
      endedAt: string
    },
  ): Promise<ExecutionResult<ExecutionFinalized>>
  list(token: VerifiedToken, input: ExecutionListInput): Promise<ExecutionPage>
  detail(token: VerifiedToken, sessionId: string): Promise<ExecutionDetail>
}

export function createExecutionService(dependencies: {
  database: ExecutionDatabase
  issuer: string
  requestId: () => string
}): ExecutionService {
  const holder = (token: VerifiedToken) => ({
    issuer: dependencies.issuer,
    subject: String(token.subject),
  })

  return {
    start: (token, input) =>
      dependencies.database.start({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
    replaceResults: (token, input) =>
      dependencies.database.replaceResults({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
    finalize: (token, input) =>
      dependencies.database.finalize({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
    list: async (token, input) => {
      const page = await dependencies.database.list({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      })
      return { items: page.items, hasMore: page.has_more }
    },
    detail: (token, sessionId) =>
      dependencies.database.detail({
        ...holder(token),
        sessionId,
        requestId: dependencies.requestId(),
      }),
  }
}
