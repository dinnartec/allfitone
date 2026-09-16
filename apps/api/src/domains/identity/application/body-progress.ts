/**
 * Body measurement use cases for Space.
 *
 * The token is carried through, never interpreted: its subject is resolved to a person
 * inside the command's own transaction, so this layer cannot record or delete for anyone
 * else.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'

import type {
  BodyProgressCommand,
  BodyProgressDatabase,
  BodyProgressDeletion,
  BodyProgressListInput,
  BodyProgressPage,
  BodyProgressRecord,
  BodyProgressRecordCreate,
  BodyProgressResult,
} from '../domain/body-progress.js'

export interface BodyProgressService {
  list(token: VerifiedToken, input: BodyProgressListInput): Promise<BodyProgressPage>
  record(
    token: VerifiedToken,
    input: Omit<BodyProgressCommand, 'requestId'> & {
      recordId: string
      measurement: BodyProgressRecordCreate
    },
  ): Promise<BodyProgressResult<BodyProgressRecord>>
  delete(
    token: VerifiedToken,
    input: Omit<BodyProgressCommand, 'requestId'> & { recordId: string },
  ): Promise<BodyProgressResult<BodyProgressDeletion>>
}

export function createBodyProgressService(dependencies: {
  database: BodyProgressDatabase
  issuer: string
  requestId: () => string
}): BodyProgressService {
  const holder = (token: VerifiedToken) => ({
    issuer: dependencies.issuer,
    subject: String(token.subject),
  })

  return {
    list: (token, input) =>
      dependencies.database.list({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
    record: (token, input) =>
      dependencies.database.record({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
    delete: (token, input) =>
      dependencies.database.delete({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
  }
}
