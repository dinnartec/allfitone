/**
 * Presentation rules for handing an organization Allfit created to its owner.
 *
 * `HU-BO-014` and `HU-BO-015`. Three things shape it that the schema cannot carry.
 *
 * **Allfit never types a person's name.** A company is named here. A natural person
 * is named from their own account when they accept, so the form has no name field
 * for them rather than an empty one somebody might fill in.
 *
 * **Created is not handed over.** The organization exists from the first click and
 * does not operate until its owner accepts. Every sentence about a handover says
 * which of the two it is, so a sale is never reported closed while it still waits.
 *
 * **Allfit does not run it in between.** The only two actions are sending the
 * invitation again and cancelling the creation, and neither changes the address.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatInstant } from './platform-access'

export type OrganizationHandover = AllfitV1Schemas['OrganizationHandover']
export type OrganizationHandoverCreate = AllfitV1Schemas['OrganizationHandoverCreate']
export type OrganizationTypeCode = AllfitV1Schemas['OrganizationTypeCode']
export type PartyKind = AllfitV1Schemas['OrganizationPartyKind']

export const ORGANIZATION_TYPES: ReadonlyArray<{ code: OrganizationTypeCode; label: string }> = [
  { code: 'gym', label: 'Gimnasio' },
  { code: 'studio', label: 'Estudio' },
  { code: 'professional_practice', label: 'Práctica profesional' },
]

export const PARTY_KINDS: ReadonlyArray<{ code: PartyKind; label: string }> = [
  { code: 'legal_entity', label: 'Una empresa' },
  { code: 'natural_person', label: 'Una persona natural' },
]

export function partyKindExplanation(kind: PartyKind): string {
  return kind === 'legal_entity'
    ? 'Escribe la razón social tal como figura en su registro.'
    : 'No escribas su nombre: se toma de su propia cuenta cuando acepte. Allfit no escribe el nombre de alguien que todavía no aceptó nada.'
}

export interface HandoverDraft {
  displayName: string
  typeCode: OrganizationTypeCode | ''
  partyKind: PartyKind | ''
  legalName: string
  siteName: string
  siteAddress: string
  ownerEmail: string
}

export const EMPTY_HANDOVER_DRAFT: HandoverDraft = {
  displayName: '',
  typeCode: '',
  partyKind: '',
  legalName: '',
  siteName: '',
  siteAddress: '',
  ownerEmail: '',
}

export type HandoverDraftIssue =
  'display-name' | 'type' | 'party-kind' | 'legal-name' | 'site-name' | 'email'

const EMAIL = /^[^\s@]+@[^\s@]+$/

export function handoverDraftIssue(draft: HandoverDraft): HandoverDraftIssue | undefined {
  const displayName = draft.displayName.trim()
  if (displayName === '' || displayName.length > 120) return 'display-name'
  if (draft.typeCode === '') return 'type'
  if (draft.partyKind === '') return 'party-kind'
  const legalName = draft.legalName.trim()
  if (draft.partyKind === 'legal_entity' && (legalName === '' || legalName.length > 160)) {
    return 'legal-name'
  }
  if (draft.siteAddress.trim() !== '' && draft.siteName.trim() === '') return 'site-name'
  const email = draft.ownerEmail.trim()
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) return 'email'
  return undefined
}

const DRAFT_MESSAGES: Record<HandoverDraftIssue, string> = {
  'display-name': 'Escribe el nombre con el que el gimnasio aparecerá, de hasta 120 caracteres.',
  type: 'Elige qué tipo de organización es.',
  'party-kind': 'Indica si responde una empresa o una persona natural.',
  'legal-name': 'Una empresa se crea con su razón social.',
  'site-name': 'Una dirección necesita el nombre de la sede a la que pertenece.',
  email: 'Escribe el correo de quien será el dueño. La invitación solo va a un correo.',
}

export function handoverDraftIssueMessage(issue: HandoverDraftIssue): string {
  return DRAFT_MESSAGES[issue]
}

/** Assumes a draft `handoverDraftIssue` accepted. */
export function toHandoverCreate(draft: HandoverDraft): OrganizationHandoverCreate {
  const siteName = draft.siteName.trim()
  const siteAddress = draft.siteAddress.trim()
  return {
    display_name: draft.displayName.trim(),
    type_code: draft.typeCode as OrganizationTypeCode,
    party_kind: draft.partyKind as PartyKind,
    // A natural person's organization never carries a name typed here.
    legal_name: draft.partyKind === 'legal_entity' ? draft.legalName.trim() : null,
    site:
      siteName === '' ? null : { name: siteName, address: siteAddress === '' ? null : siteAddress },
    owner_email: draft.ownerEmail.trim().toLowerCase(),
  }
}

export type HandoverStage = 'waiting' | 'lapsed' | 'declined' | 'claimed' | 'cancelled'

export function handoverStage(handover: OrganizationHandover, now: number): HandoverStage {
  if (handover.status === 'cancelled') return 'cancelled'
  if (handover.status !== 'unclaimed') return 'claimed'
  const invitation = handover.invitation
  if (invitation?.intent_status === 'rejected') return 'declined'
  if (invitation?.status === 'pending' && Date.parse(invitation.expires_at) > now) {
    return 'waiting'
  }
  return 'lapsed'
}

const STAGE_LABELS: Record<HandoverStage, string> = {
  waiting: 'Esperando a su dueño',
  lapsed: 'La invitación venció',
  declined: 'Su dueño la rechazó',
  claimed: 'Entregado',
  cancelled: 'Cancelado',
}

export function stageLabel(stage: HandoverStage): string {
  return STAGE_LABELS[stage]
}

export type StageTone = 'success' | 'warning' | 'destructive' | 'secondary'

export function stageTone(stage: HandoverStage): StageTone {
  if (stage === 'claimed') return 'success'
  if (stage === 'waiting') return 'warning'
  if (stage === 'cancelled') return 'secondary'
  return 'destructive'
}

/** What the handover means right now, said as a sentence rather than a state name. */
export function stageSentence(handover: OrganizationHandover, stage: HandoverStage): string {
  const hint = handover.invitation?.contact_hint ?? 'su dueño'
  switch (stage) {
    case 'waiting':
      return `La invitación a ${hint} vale hasta ${formatInstant(handover.invitation?.expires_at)}. El gimnasio existe, pero no opera hasta que su dueño acepte.`
    case 'lapsed':
      return `La invitación a ${hint} venció sin respuesta. El gimnasio sigue sin operar: puedes enviarla de nuevo a la misma dirección o cancelar la creación.`
    case 'declined':
      return `Quien recibió la invitación en ${hint} la rechazó. El gimnasio sigue sin operar: puedes enviarla de nuevo a la misma dirección o cancelar la creación.`
    case 'claimed':
      return `Su dueño lo aceptó el ${formatInstant(handover.claimed_at)} y ya opera. Desde aquí no se reenvía ni se cancela: lo administra su dueño en Studio.`
    case 'cancelled':
      return `Se canceló el ${formatInstant(handover.cancelled_at)}. Nadie lo reclamó y su invitación quedó retirada.`
  }
}

export function canActOn(stage: HandoverStage): boolean {
  return stage === 'waiting' || stage === 'lapsed' || stage === 'declined'
}

/** A live invitation is sent again as it is; a spent one is replaced. The screen says which. */
export function resendNotice(stageBefore: HandoverStage): string {
  return stageBefore === 'waiting'
    ? 'Se envió de nuevo la misma invitación. El enlace del primer correo sigue sirviendo.'
    : 'Se envió una invitación nueva a la misma dirección.'
}

export const CANCELLED_NOTICE =
  'La creación quedó cancelada y su invitación retirada. El gimnasio no se puede reclamar.'

export function responsibleSentence(handover: OrganizationHandover): string {
  if (handover.party_kind === 'legal_entity') return handover.legal_name ?? 'Empresa'
  return handover.status === 'unclaimed' || handover.status === 'cancelled'
    ? 'Una persona natural. Su nombre se toma de su propia cuenta cuando acepte.'
    : 'Una persona natural, nombrada con su propia cuenta al aceptar.'
}

export function handoverMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber de ciclo de vida de gimnasios. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    conflict:
      'El gimnasio ya no espera a su dueño: puede que lo haya aceptado o que alguien haya cancelado la creación. Se volvió a leer su estado.',
    'not-found':
      'No hay una entrega para este gimnasio. Un gimnasio que creó su propio dueño nunca pasó por aquí.',
    'validation-failed':
      'Los datos no cumplen el contrato. Revisa el nombre, la razón social y el correo.',
    'invalid-request': 'La petición no se pudo leer. Recarga la página y vuelve a intentarlo.',
    'idempotency-in-progress': 'La misma operación todavía se está procesando. Espera un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable':
      'El servicio no respondió. Reintenta en un momento: no se duplicará nada.',
    'network-unavailable': 'No hay conexión con el API. Reintenta: no se duplicará nada.',
  }
  return messages[code] ?? 'No se pudo completar la operación.'
}
