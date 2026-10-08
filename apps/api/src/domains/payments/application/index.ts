/**
 * Platform plan use cases.
 *
 * No authorization branch and no review logic: the commercial duty, AAL2, who may
 * publish what, and whether a proposal changes anything are all resolved inside the
 * command's own transaction.
 */

import type { BackofficeActor } from '../../identity/index.js'
import type {
  PaymentsCommandContext,
  PlatformPlanCatalogue,
  PlatformPlanCreate,
  PlatformPlanDatabase,
  PlatformPlanResult,
  PlatformPlanVersionProposal,
} from '../domain/index.js'

type VersionCommand = PaymentsCommandContext & { planId: string; versionId: string }

export interface PlatformPlanService {
  list(actor: BackofficeActor, input: { requestId: string }): Promise<PlatformPlanCatalogue>
  create(
    actor: BackofficeActor,
    input: PaymentsCommandContext & { plan: PlatformPlanCreate },
  ): Promise<PlatformPlanResult>
  propose(
    actor: BackofficeActor,
    input: PaymentsCommandContext & { planId: string; proposal: PlatformPlanVersionProposal },
  ): Promise<PlatformPlanResult>
  publish(actor: BackofficeActor, input: VersionCommand): Promise<PlatformPlanResult>
  withdraw(actor: BackofficeActor, input: VersionCommand): Promise<PlatformPlanResult>
}

export function createPlatformPlanService(database: PlatformPlanDatabase): PlatformPlanService {
  const from = (actor: BackofficeActor) => ({
    actorPersonId: actor.personId,
    actorSessionId: actor.sessionId,
  })

  return {
    list: (actor, input) => database.list({ ...from(actor), ...input }),
    create: (actor, input) => database.create({ ...from(actor), ...input }),
    propose: (actor, input) => database.propose({ ...from(actor), ...input }),
    publish: (actor, input) => database.publish({ ...from(actor), ...input }),
    withdraw: (actor, input) => database.withdraw({ ...from(actor), ...input }),
  }
}
