/**
 * The native half of a gym from the person's side: the stored session, the bearer header
 * and `expo-crypto`. Split from `gym-affiliation.ts` so that file stays loadable by the
 * test runner.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import { newCommand } from '@allfitone/contracts/commands'
import * as Crypto from 'expo-crypto'

import { authorizedGet, authorizedPost } from './index'
import { authenticated } from './session'
import {
  createInvitationFlow,
  type InvitationDecisionResult,
  type InvitationFlow,
  type InvitationPresentation,
  type PendingInvitationList,
} from './gym-affiliation'

export type MyRelationship = AllfitV1Schemas['SpaceRelationship']
export type Cover = AllfitV1Schemas['ListedRelationshipSubstitution']
export type HistoryPage = AllfitV1Schemas['RelationshipHistoryPage']
type RelationshipPage = AllfitV1Schemas['SpaceRelationshipPage']
type CoverPage = AllfitV1Schemas['RelationshipSubstitutionPage']

const command = () =>
  newCommand(
    { randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)) },
    Date.now(),
  )

export function createSpaceInvitationFlow(): InvitationFlow {
  return createInvitationFlow({
    newCommand: command,
    transport: {
      listMine: () =>
        authenticated((token) =>
          authorizedGet<PendingInvitationList>('/space/v1/client-invitations', token),
        ),
      readMine: (invitationId) =>
        authenticated((token) =>
          authorizedGet<InvitationPresentation>(
            `/space/v1/client-invitations/${invitationId}`,
            token,
          ),
        ),
      // The token goes in the body, never in a URL or a log.
      resolve: (value) =>
        authenticated((token) =>
          authorizedPost<InvitationPresentation>(
            '/space/v1/client-invitations/resolve',
            command(),
            { token: value },
            token,
          ),
        ),
      decide: (headers, body) =>
        authenticated((token) =>
          authorizedPost<InvitationDecisionResult>(
            '/space/v1/client-invitations/decisions',
            headers,
            body,
            token,
          ),
        ),
    },
  })
}

/** Her gyms: the relationships, their covers, their history, and leaving one. */
export const gyms = {
  list: () =>
    authenticated((token) =>
      authorizedGet<RelationshipPage>('/space/v1/relationships?limit=100', token),
    ),
  covers: (relationshipId: string) =>
    authenticated((token) =>
      authorizedGet<CoverPage>(`/space/v1/relationships/${relationshipId}/substitutions`, token),
    ),
  history: (relationshipId: string) =>
    authenticated((token) =>
      authorizedGet<HistoryPage>(`/space/v1/relationships/${relationshipId}/events`, token),
    ),
  decideCover: (relationshipId: string, coverId: string, decision: 'accepted' | 'rejected') =>
    authenticated((token) =>
      authorizedPost<AllfitV1Schemas['RelationshipSubstitutionDecision']>(
        `/space/v1/relationships/${relationshipId}/substitutions/${coverId}/decision`,
        command(),
        { decision },
        token,
      ),
    ),
  end: (relationshipId: string) =>
    authenticated((token) =>
      authorizedPost<AllfitV1Schemas['MyRelationshipTermination']>(
        `/space/v1/relationships/${relationshipId}/termination`,
        command(),
        {},
        token,
      ),
    ),
}
