/**
 * Body measurement use cases for Space.
 *
 * The token is carried through, never interpreted: its subject is resolved to a person
 * inside the command's own transaction, so this layer cannot read or delete for anyone
 * else. Recording belongs to onboarding, which owns `OP-IDN-006`.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'

import type {
  BodyProgressCommand,
  BodyProgressDatabase,
  BodyProgressDeletion,
  BodyProgressListInput,
  BodyProgressPage,
  BodyProgressResult,
} from '../domain/body-progress.js'

export interface BodyProgressService {
  list(token: VerifiedToken, input: BodyProgressListInput): Promise<BodyProgressPage>
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
    delete: (token, input) =>
      dependencies.database.delete({
        ...holder(token),
        ...input,
        requestId: dependencies.requestId(),
      }),
  }
}
