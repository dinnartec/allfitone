/**
 * Presentation rules for verifying a professional credential.
 *
 * A verification is what lets a credential count, so the copy here carries weight
 * the schema cannot. Four things it has to make true.
 *
 * **There is no default result.** Nothing is preselected and nothing is sent until
 * a verifier chooses, because a missing answer must never read as a pass.
 *
 * **"Not verifiable" is an answer, not a failure.** When the evidence does not
 * reach, saying so is the correct outcome, and it is shown with the same weight as
 * the other two.
 *
 * **The validity is a consequence, never a field.** The server derives it from
 * twelve months, the source's expiry and the credential's own. The screen says what
 * that means and offers nothing to change it.
 *
 * **A conflict is said before anyone tries.** The server hint says whether this
 * verifier may decide; when they may not, the reason is on the card and there is
 * no form to fill.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type CredentialVerificationRequest = AllfitV1Schemas['CredentialVerificationRequest']
export type CredentialVerificationOutcome = AllfitV1Schemas['CredentialVerificationOutcome']
export type CredentialVerificationDecisionCreate =
  AllfitV1Schemas['CredentialVerificationDecisionCreate']
export type CredentialVerificationMethod = AllfitV1Schemas['CredentialVerificationMethod']
export type CredentialVerificationResult = AllfitV1Schemas['CredentialVerificationResult']
export type CredentialRenewalDue = AllfitV1Schemas['CredentialRenewalDue']

export const VERIFICATION_RESULTS: readonly CredentialVerificationResult[] = [
  'verified',
  'rejected',
  'unverifiable',
]

export const VERIFICATION_METHODS: readonly CredentialVerificationMethod[] = [
  'official_registry_lookup',
  'issuer_confirmation',
]

const RESULT_LABELS: Record<string, string> = {
  verified: 'Verificado',
  rejected: 'Rechazado',
  unverifiable: 'No verificable',
  revoked: 'Revocado',
}

export function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result
}

const RESULT_EXPLANATIONS: Record<CredentialVerificationResult, string> = {
  verified: 'La fuente confirma el título tal como está declarado, y está vigente.',
  rejected: 'La fuente contradice lo declarado: no existe, no coincide o no está vigente.',
  unverifiable:
    'La evidencia no alcanza para confirmarlo ni para negarlo. Es una respuesta válida, no un error.',
}

export function resultExplanation(result: CredentialVerificationResult): string {
  return RESULT_EXPLANATIONS[result]
}

export type ResultTone = 'success' | 'destructive' | 'secondary'

/** Not verifiable is neutral: it is an honest answer, not a failed check. */
export function resultTone(result: string): ResultTone {
  if (result === 'verified') return 'success'
  if (result === 'rejected') return 'destructive'
  return 'secondary'
}

const METHOD_LABELS: Record<CredentialVerificationMethod, string> = {
  official_registry_lookup: 'Registro oficial',
  issuer_confirmation: 'Confirmación con quien lo emitió',
}

export function methodLabel(method: CredentialVerificationMethod): string {
  return METHOD_LABELS[method]
}

const METHOD_HINTS: Record<CredentialVerificationMethod, string> = {
  official_registry_lookup: 'Busca el número en el registro oficial de la profesión.',
  issuer_confirmation: 'Confirma directamente con la entidad que lo emitió.',
}

export function methodHint(method: CredentialVerificationMethod): string {
  return METHOD_HINTS[method]
}

export function kindLabel(kind: CredentialVerificationRequest['kind']): string {
  return kind === 'renewal' ? 'Renovación' : 'Primera verificación'
}

export interface VerificationDraft {
  result: CredentialVerificationResult | undefined
  method: CredentialVerificationMethod
  sourceAuthority: string
  sourceJurisdiction: string
  sourceReference: string
  sourceStatus: string
  sourceCheckedAt: string
  sourceValidTo: string
}

/**
 * A blank decision. The method starts at the suggestion because it says where to
 * look, not what was found; the result starts empty because it is the finding.
 */
export function draftFor(
  request: CredentialVerificationRequest,
  now: Date = new Date(),
): VerificationDraft {
  return {
    result: undefined,
    method: request.suggested_method,
    sourceAuthority: '',
    sourceJurisdiction: '',
    sourceReference: '',
    sourceStatus: '',
    sourceCheckedAt: localDateTime(now),
    sourceValidTo: '',
  }
}

/** The value a `datetime-local` input expects, in the viewer's own time zone. */
export function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export type DecisionIssue = 'result' | 'source' | 'checked' | 'lapsed'

export function decisionIssue(
  draft: VerificationDraft,
  now: number = Date.now(),
): DecisionIssue | undefined {
  if (!draft.result) return 'result'
  const source = [
    draft.sourceAuthority,
    draft.sourceJurisdiction,
    draft.sourceReference,
    draft.sourceStatus,
  ]
  if (source.some((value) => value.trim() === '')) return 'source'
  const checkedAt = Date.parse(draft.sourceCheckedAt)
  if (Number.isNaN(checkedAt) || checkedAt > now) return 'checked'
  if (draft.result === 'verified' && draft.sourceValidTo !== '') {
    const validTo = Date.parse(draft.sourceValidTo)
    if (Number.isNaN(validTo) || validTo <= now) return 'lapsed'
  }
  return undefined
}

const DECISION_MESSAGES: Record<DecisionIssue, string> = {
  result: 'Elige un resultado. No hay uno por defecto: nada queda verificado por omisión.',
  source:
    'Anota la fuente que consultaste: la autoridad, la jurisdicción, la referencia y lo que respondió.',
  checked: 'La fecha de la consulta no puede estar en el futuro.',
  lapsed:
    'La fuente dice que el título ya venció, así que no puede quedar verificado. Regístralo como rechazado o no verificable.',
}

export function decisionIssueMessage(issue: DecisionIssue): string {
  return DECISION_MESSAGES[issue]
}

/**
 * What the API receives. There is no field for a validity, a policy or a
 * fingerprint: the server derives all three.
 */
export function toDecision(
  requestId: string,
  result: CredentialVerificationResult,
  draft: VerificationDraft,
): CredentialVerificationDecisionCreate {
  return {
    request_id: requestId,
    result,
    method: draft.method,
    source_authority: draft.sourceAuthority.trim(),
    source_jurisdiction: draft.sourceJurisdiction.trim(),
    source_reference: draft.sourceReference.trim(),
    source_status: draft.sourceStatus.trim(),
    source_checked_at: new Date(draft.sourceCheckedAt).toISOString(),
    source_valid_to:
      draft.sourceValidTo === '' ? null : new Date(draft.sourceValidTo).toISOString(),
  }
}

export function validitySentence(): string {
  return 'Si queda verificado, vence como máximo en 12 meses, o antes si la fuente dice que vence antes. No se puede pedir una vigencia más larga.'
}

export function conflictSentence(): string {
  return 'No puedes decidir sobre este título: eres quien lo declaró o compartes un gimnasio activo con esa persona. Tiene que verificarlo otra persona del equipo.'
}

export function formatDay(instant: string | null): string {
  if (!instant) return 'sin fecha'
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant))
}

/**
 * What the screen says once a decision is recorded. A verification says until
 * when, and says in the same breath that nothing else about the person changed.
 */
export function decisionSuccess(outcome: CredentialVerificationOutcome): string {
  const record = outcome.verification
  if (!record) return 'La decisión quedó registrada.'
  if (record.result === 'verified') {
    return `Verificado hasta el ${formatDay(record.valid_to)}. Ningún otro dato de esta persona queda verificado por esto.`
  }
  return `Quedó registrado como «${resultLabel(record.result)}». La persona lo verá en su perfil.`
}

export function previousSentence(request: CredentialVerificationRequest): string | null {
  if (!request.previous_result) return null
  const until = request.previous_valid_to
    ? `, vigente hasta el ${formatDay(request.previous_valid_to)}`
    : ''
  return `La verificación anterior quedó «${resultLabel(request.previous_result)}»${until}. Esa decisión no cambia.`
}

export function renewalSentence(due: CredentialRenewalDue, now: number = Date.now()): string {
  const day = formatDay(due.last_valid_to)
  return Date.parse(due.last_valid_to) <= now ? `Venció el ${day}.` : `Vence el ${day}.`
}

export const RENEWAL_OPENED = 'Renovación abierta. La verificación anterior queda como estaba.'

export function verificationMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'No puedes decidir esta verificación: tu deber de verificación no está vigente o tienes un conflicto con esta persona. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    conflict:
      'Esta solicitud ya no está pendiente: otra persona la decidió, o el título se retiró o se corrigió mientras la tenías abierta.',
    'not-found': 'Esa solicitud no existe.',
    'validation-failed':
      'La decisión no cumple el contrato. Revisa la fuente consultada y las fechas.',
    'invalid-request': 'Falta un identificador de comando. Vuelve a intentarlo.',
    'idempotency-in-progress': 'La decisión anterior sigue procesándose. Reintenta en un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo completar la operación.'
}
