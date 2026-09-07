/**
 * Presentation and input rules for publishing result contracts.
 *
 * A result contract says what a session must carry to count as complete. Nothing
 * here validates the contract itself — the server does, and it is the only
 * authority. What lives here is the shape of the request and the vocabulary the
 * operator reads, so a malformed publication is refused before it travels and a
 * refusal is explained in the operator's terms.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ActivityFamily = AllfitV1Schemas['ActivityFamily']
export type ContractFixture = AllfitV1Schemas['ContractFixture']

export const ACTIVITY_FAMILIES: readonly ActivityFamily[] = [
  'strength',
  'endurance',
  'interval',
  'mobility',
]

const FAMILY_LABELS: Record<ActivityFamily, string> = {
  strength: 'Fuerza',
  endurance: 'Resistencia',
  interval: 'Intervalos',
  mobility: 'Movilidad',
}

export function activityFamilyLabel(family: ActivityFamily): string {
  return FAMILY_LABELS[family]
}

export function contractStatusLabel(status: 'published' | 'deprecated'): string {
  return status === 'published' ? 'Publicado' : 'Deprecado'
}

const CONTRACT_CODE = /^[a-z][a-z0-9_.]{1,63}$/

export function isValidContractCode(value: string): boolean {
  return CONTRACT_CODE.test(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidActivityTypeId(value: string): boolean {
  return UUID.test(value)
}

export type JsonDocumentResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'malformed' | 'not-an-object' }

/**
 * The envelope and the minimums are opaque documents to everything except the
 * contract itself, so the only thing worth checking here is that the operator
 * typed a JSON object rather than a list, a number or something unparseable.
 */
export function parseJsonDocument(source: string): JsonDocumentResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-an-object' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

export interface FixtureDraft {
  kind: ContractFixture['kind']
  payload: string
  expected: string
}

export function emptyFixtures(): FixtureDraft[] {
  return [
    { kind: 'valid', payload: '{}', expected: '' },
    { kind: 'invalid', payload: '{}', expected: '' },
  ]
}

export type FixtureIssue =
  'payload-malformed' | 'payload-not-an-object' | 'expected-missing' | 'expected-too-long'

export function fixtureIssue(draft: FixtureDraft): FixtureIssue | undefined {
  const payload = parseJsonDocument(draft.payload)
  if (!payload.ok) {
    return payload.reason === 'malformed' ? 'payload-malformed' : 'payload-not-an-object'
  }
  const expected = draft.expected.trim()
  if (expected.length === 0) return 'expected-missing'
  if (expected.length > 200) return 'expected-too-long'
  return undefined
}

/**
 * A contract nobody demonstrated refusing something is not a contract, so the
 * suite needs both outcomes. The server refuses the publication regardless; this
 * check exists so the operator is told before the request travels.
 */
export function fixturesDemonstrateBothOutcomes(drafts: readonly FixtureDraft[]): boolean {
  return (
    drafts.some((draft) => draft.kind === 'valid') &&
    drafts.some((draft) => draft.kind === 'invalid')
  )
}

export function toContractFixtures(drafts: readonly FixtureDraft[]): ContractFixture[] {
  return drafts.map((draft) => {
    const payload = parseJsonDocument(draft.payload)
    return {
      kind: draft.kind,
      payload: payload.ok ? payload.value : {},
      expected: draft.expected.trim(),
    }
  })
}

const FIXTURE_MESSAGES: Record<FixtureIssue, string> = {
  'payload-malformed': 'El caso no es JSON válido.',
  'payload-not-an-object': 'El caso debe ser un objeto JSON.',
  'expected-missing': 'Escribe qué se espera de este caso.',
  'expected-too-long': 'El resultado esperado admite hasta 200 caracteres.',
}

export function fixtureIssueMessage(issue: FixtureIssue): string {
  return FIXTURE_MESSAGES[issue]
}

/**
 * What the operator is told when the server refuses.
 *
 * `conflict` covers the published-content guard: a published version is
 * immutable and deprecation is terminal, so the answer is to publish the next
 * version rather than to retry this one.
 */
export function resultContractMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene el deber de curaduría del catálogo vigente. Puede haber vencido o haber sido revocado.',
    'not-found': 'El tipo de actividad no está en el catálogo global publicado.',
    conflict:
      'Una versión publicada es inmutable y deprecar es terminal. Para corregir, publica la versión siguiente.',
    'validation-failed':
      'La publicación no cumple el contrato: revisa el código, la familia y los casos de prueba.',
    'invalid-request': 'Falta un identificador de comando. Vuelve a intentarlo.',
    'idempotency-in-progress': 'El comando anterior sigue procesándose. Reintenta en un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo publicar el contrato.'
}
