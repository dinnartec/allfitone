/**
 * Health context use cases for Space.
 *
 * The token is carried through, never interpreted: its subject is resolved to a person
 * inside the command's own transaction, so this layer cannot declare or delete for anyone
 * else.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'

import type {
  HealthContextClaim,
  HealthContextCommand,
  HealthContextDatabase,
  HealthContextDeclaration,
  HealthContextDeletion,
  HealthContextListInput,
  HealthContextPage,
  HealthContextResult,
} from '../domain/health-context.js'

export interface HealthContextService {
  list(token: VerifiedToken, input: HealthContextListInput): Promise<HealthContextPage>
  declare(
    token: VerifiedToken,
    input: Omit<HealthContextCommand, 'requestId'> & {
      claimId: string
      claim: HealthContextDeclaration
    },
  ): Promise<HealthContextResult<HealthContextClaim>>
  delete(
    token: VerifiedToken,
    input: Omit<HealthContextCommand, 'requestId'> & { claimId: string },
  ): Promise<HealthContextResult<HealthContextDeletion>>
}

export function createHealthContextService(dependencies: {
  database: HealthContextDatabase
  issuer: string
  requestId: () => string
}): HealthContextService {
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
    declare: (token, input) =>
      dependencies.database.declare({
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
