/** Execution module composition. */

import { randomUUID } from 'node:crypto'

import { createExecutionService, type ExecutionService } from './application/sessions.js'
import { createExecutionDatabase } from './infrastructure/sessions.js'

let cachedSessions: ExecutionService | undefined

export function spaceExecutionService(): ExecutionService {
  if (cachedSessions) return cachedSessions
  const issuer = process.env.WORKOS_ISSUER
  if (!issuer) throw new Error('WORKOS_ISSUER is not set')
  cachedSessions = createExecutionService({
    database: createExecutionDatabase(),
    issuer,
    requestId: () => randomUUID(),
  })
  return cachedSessions
}
