/**
 * A gym from the person's side (HU-SP-016..020, HU-SP-095): the invitation she answers,
 * the gyms she trains at, the covers proposed to her and the story of each relationship.
 *
 * Accepting the relationship shares nothing by itself, and each category is answered on
 * its own; a category she does not touch is a no. The flow keeps one command per
 * invitation until it is answered, so a retry after a dropped connection is the same
 * answer and never a second relationship.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

import { shortDate } from './pro'

export type InvitationPresentation = AllfitV1Schemas['ClientInvitationPresentation']
export type InvitationScopeOption = AllfitV1Schemas['ClientInvitationScopeOption']
export type PendingInvitationList = AllfitV1Schemas['ClientInvitationPendingList']
export type PendingInvitation = AllfitV1Schemas['ClientInvitationPending']
export type InvitationDecisionResult = AllfitV1Schemas['ClientInvitationDecisionResult']
export type InvitationDecisionBody = AllfitV1Schemas['ClientInvitationDecisionCreate']
export type Decision = 'accepted' | 'rejected'

/** How an invitation is named: the emailed token, or the id of a pending one. */
export type InvitationKey = { readonly token: string } | { readonly invitationId: string }

export interface InvitationTransport {
  listMine(): Promise<PendingInvitationList>
  readMine(invitationId: string): Promise<InvitationPresentation>
  resolve(token: string): Promise<InvitationPresentation>
  decide(command: CommandHeaders, body: InvitationDecisionBody): Promise<InvitationDecisionResult>
}

export interface InvitationFlow {
  listMine(): Promise<readonly PendingInvitation[]>
  read(key: InvitationKey): Promise<InvitationPresentation>
  decide(decision: {
    readonly invitation: InvitationKey
    readonly intentId: string
    readonly relationship: Decision
    readonly scopes: Readonly<Record<string, Decision>>
  }): Promise<InvitationDecisionResult>
}

export function createInvitationFlow(dependencies: {
  transport: InvitationTransport
  newCommand: () => CommandHeaders
}): InvitationFlow {
  // One per invitation until it is answered: a retry is the same answer.
  const pending = new Map<string, CommandHeaders>()
  return {
    listMine: async () => (await dependencies.transport.listMine()).data,
    read: (key) =>
      'token' in key
        ? dependencies.transport.resolve(key.token)
        : dependencies.transport.readMine(key.invitationId),
    async decide(decision) {
      const name =
        'token' in decision.invitation
          ? decision.invitation.token
          : decision.invitation.invitationId
      const command = pending.get(name) ?? dependencies.newCommand()
      pending.set(name, command)
      const body: InvitationDecisionBody = {
        ...('token' in decision.invitation
          ? { token: decision.invitation.token }
          : { invitation_id: decision.invitation.invitationId }),
        invitation_intent_id: decision.intentId,
        relationship_decision: decision.relationship,
        scope_decisions: { ...decision.scopes },
      }
      const result = await dependencies.transport.decide(command, body)
      pending.delete(name)
      return result
    },
  }
}

const SCOPE_NAME: Record<string, string> = {
  relationship_training: 'Tu entrenamiento con ellos',
  prior_training_history: 'Tu historial previo',
  body_progress: 'Medidas y fotos',
  health_context: 'Dolor y limitaciones',
  nutrition_intake: 'Tus comidas',
  nutrition_guidance: 'Metas de nutrición',
  nutrition_media: 'Fotos de tus comidas',
}

/** A category by the title the gym presented it with, or by its plain name. */
export function scopeTitle(option: {
  readonly scope_code: string
  readonly presented_snapshot: Readonly<Record<string, unknown>>
}): string {
  const title = option.presented_snapshot.title
  return typeof title === 'string' && title.trim() !== ''
    ? title
    : (SCOPE_NAME[option.scope_code] ?? option.scope_code)
}

export function sharedSummary(
  decisions: Readonly<Record<string, Decision>>,
  asked: number,
): string {
  if (asked === 0) return 'No pide ningún dato'
  const accepted = Object.values(decisions).filter((decision) => decision === 'accepted').length
  return `Compartes ${String(accepted)} de ${String(asked)}`
}

export const invitationExpiry = (instant: string): string => `vence el ${shortDate(instant)}`

/** Covers still waiting on her: proposed, and not already past their last day. */
export function pendingCovers<
  T extends { readonly status: string; readonly ends_on: string | null },
>(covers: readonly T[], now: Date = new Date()): T[] {
  const today = now.toISOString().slice(0, 10)
  return covers.filter(
    (cover) => cover.status === 'proposed' && (cover.ends_on === null || cover.ends_on >= today),
  )
}

/** One moment of a relationship, said as she would say it. */
export function historyLine(event: {
  readonly type: string
  readonly detail: Readonly<Record<string, unknown>>
}): string {
  const name = typeof event.detail.display_name === 'string' ? event.detail.display_name : 'Alguien'
  switch (event.type) {
    case 'relationship_started':
      return 'Aceptaste la invitación'
    case 'holder_assigned':
      return `${name} es tu coach`
    case 'holder_ended':
      return `${name} dejó de ser tu coach`
    case 'substitution_proposed':
      return `${name} propone cubrirte`
    case 'substitution_accepted':
      return `Aceptaste que ${name} te cubra`
    case 'substitution_ended':
      return `${name} dejó de cubrirte`
    case 'consent_decided': {
      const named = SCOPE_NAME[String(event.detail.scope_code)]
      // Inside a sentence, so the name loses its capital.
      const scope = named ? named.charAt(0).toLowerCase() + named.slice(1) : 'una categoría'
      return event.detail.decision === 'accepted'
        ? `Compartiste ${scope}`
        : `No compartiste ${scope}`
    }
    case 'grant_revoked': {
      const named = SCOPE_NAME[String(event.detail.scope_code)]
      return `Dejaste de compartir ${named ? named.charAt(0).toLowerCase() + named.slice(1) : 'una categoría'}`
    }
    case 'relationship_ended':
      // Seen from Space, «declared by us» is her own decision.
      return event.detail.declared_by_us === true
        ? 'Terminaste la relación'
        : 'El gimnasio terminó la relación'
    default:
      return 'Cambió la relación'
  }
}

/** The emailed token, read from the fragment so it never reaches a server log. */
export function tokenFromLink(url: string | null): string | undefined {
  const fragment = url?.split('#')[1]
  if (!fragment) return undefined
  const token = new URLSearchParams(fragment).get('token')
  return token ? token : undefined
}

// A calendar day read at noon, so no zone moves it to the day before.
const day = (date: string): string => shortDate(`${date}T12:00:00`)

/** When a cover runs: from the day it starts to its last day, if it has one. */
export function coverSpan(cover: {
  readonly valid_from: string
  readonly ends_on: string | null
}): string {
  const from = shortDate(cover.valid_from)
  return cover.ends_on ? `del ${from} al ${day(cover.ends_on)}` : `desde el ${from}`
}

export function endedSpan(relationship: {
  readonly started_at: string
  readonly ended_at: string | null
}): string {
  const until = relationship.ended_at ? ` al ${shortDate(relationship.ended_at)}` : ''
  return `Del ${shortDate(relationship.started_at)}${until} · ya no ven nada nuevo`
}
