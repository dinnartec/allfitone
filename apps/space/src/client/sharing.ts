/**
 * «Lo que compartes» (N-8b) and taking one category back (N-8c) — HU-SP-030, HU-SP-031.
 *
 * Every category a gym asked her for, with how it stands now: shared since a date,
 * declined, taken back, or kept by a gym she no longer trains with. Each is its own
 * permission, so the sheet says plainly that taking one back changes nothing else and
 * deletes nothing of hers — and that it cannot be undone.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { scopeTitle } from './gym-affiliation'
import { shortDate } from './pro'

export type Consent = AllfitV1Schemas['SpaceConsent']

export interface SharingGroup {
  readonly relationshipId: string
  readonly organizationName: string
  readonly status: Consent['relationship_status']
  readonly startedAt: string
  readonly endedAt: string | null
  readonly training: readonly Consent[]
  readonly nutrition: readonly Consent[]
}

// The order the designs list them in, nutrition on a card of its own.
const TRAINING = [
  'relationship_training',
  'body_progress',
  'prior_training_history',
  'health_context',
]
const NUTRITION = ['nutrition_intake', 'nutrition_media', 'nutrition_guidance']

const rank = (order: readonly string[], code: string) => {
  const at = order.indexOf(code)
  return at < 0 ? order.length : at
}

export function groupConsents(consents: readonly Consent[]): SharingGroup[] {
  const byRelationship = new Map<string, Consent[]>()
  for (const consent of consents) {
    const list = byRelationship.get(consent.relationship_id) ?? []
    list.push(consent)
    byRelationship.set(consent.relationship_id, list)
  }
  const groups = [...byRelationship.values()].flatMap((list) => {
    const [first] = list
    if (!first) return []
    const of = (order: readonly string[]) =>
      list
        .filter((item) => order.includes(item.scope_code))
        .sort((left, right) => rank(order, left.scope_code) - rank(order, right.scope_code))
    return [
      {
        relationshipId: first.relationship_id,
        organizationName: first.organization_name,
        status: first.relationship_status,
        startedAt: first.started_at,
        endedAt: first.ended_at,
        training: of(TRAINING),
        nutrition: of(NUTRITION),
      },
    ]
  })
  // The gyms she trains at first; among each kind, the most recent first.
  return groups.sort(
    (left, right) =>
      Number(left.status !== 'active') - Number(right.status !== 'active') ||
      right.startedAt.localeCompare(left.startedAt),
  )
}

const LEVEL: Record<string, string> = { read: 'Lectura', contribute: 'Lectura y propuestas' }

export function consentLine(consent: Consent): string {
  switch (consent.grant_status) {
    case 'active':
      return `${LEVEL[consent.access_level ?? 'read'] ?? 'Lectura'} · desde el ${shortDate(consent.granted_at ?? consent.decided_at)}`
    case 'frozen':
      return `Aún pueden ver lo compartido hasta el ${shortDate(consent.frozen_at ?? consent.decided_at)}`
    case 'revoked':
      return `Dejaste de compartirlo el ${shortDate(consent.revoked_at ?? consent.decided_at)}`
    default:
      return 'Elegiste no compartirlo'
  }
}

/** Only what a gym can still read, or still keeps, can be taken back. */
export const canRevoke = (consent: Consent): boolean =>
  consent.grant_status === 'active' || consent.grant_status === 'frozen'

export function groupCaption(group: SharingGroup): string {
  if (group.status !== 'active') {
    return `Terminó el ${shortDate(group.endedAt ?? group.startedAt)} · ya no ven nada nuevo`
  }
  const all = [...group.training, ...group.nutrition]
  const shared = all.filter((item) => item.grant_status === 'active').length
  return `Activa desde el ${shortDate(group.startedAt)} · ${String(shared)} de ${String(all.length)} categorías`
}

const inSentence = (title: string) => title.charAt(0).toLowerCase() + title.slice(1)

export function revokeCopy(consent: Consent): { title: string; lines: string[] } {
  const what = inSentence(scopeTitle(consent))
  return {
    title: `¿Dejar de compartir ${what} con ${consent.organization_name}?`,
    lines: [
      consent.grant_status === 'frozen'
        ? `Dejan de conservar ${what}, también lo que ya les compartiste.`
        : `Dejan de ver ${what} ahora mismo.`,
      'Lo demás que compartes no cambia: cada permiso es aparte.',
      'No se borra nada tuyo. Sigue en tu Fitness ID.',
      'No se puede deshacer: para volver a compartir hará falta un permiso nuevo.',
    ],
  }
}
