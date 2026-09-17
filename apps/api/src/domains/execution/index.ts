/**
 * Public interface of the execution domain.
 *
 * Everything outside this module reaches execution through here and nowhere else — the
 * boundary rules enforce it.
 */

export { spaceExecutionRoutes } from './handlers/space-executions.js'
export type { ExecutionService } from './application/sessions.js'
