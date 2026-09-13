import { describe, expect, test } from 'bun:test'

import {
  VERIFICATION_RESULTS,
  conflictSentence,
  decisionIssue,
  decisionIssueMessage,
  decisionSuccess,
  draftFor,
  kindLabel,
  methodLabel,
  previousSentence,
  renewalSentence,
  resultExplanation,
  resultLabel,
  resultTone,
  toDecision,
  validitySentence,
  verificationMessage,
  type CredentialVerificationRequest,
  type VerificationDraft,
} from './credential-verification'

const NOW = Date.parse('2026-09-13T15:00:00.000Z')

function request(
  overrides: Partial<CredentialVerificationRequest> = {},
): CredentialVerificationRequest {
  return {
    request_id: '019aa000-0000-7000-8000-000000000501',
    kind: 'initial',
    requested_at: '2026-09-12T15:00:00.000Z',
    credential_id: '019aa000-0000-7000-8000-000000000601',
    credential_type_code: 'professional_license',
    credential_type_name: 'Licencia o matrícula profesional',
    issuer: 'Colegio Colombiano de Fisioterapeutas',
    credential_name: 'Tarjeta profesional',
    credential_identifier: 'TP-12345',
    issued_on: '2019-06-01',
    expires_on: null,
    verification_url: 'https://registro.example.test/TP-12345',
    holder_person_id: '019aa000-0000-7000-8000-000000000005',
    holder_given_name: 'Valentina',
    holder_family_name: 'Ríos',
    suggested_method: 'official_registry_lookup',
    previous_result: null,
    previous_valid_to: null,
    viewer_can_decide: true,
    ...overrides,
  }
}

function completed(overrides: Partial<VerificationDraft> = {}): VerificationDraft {
  return {
    ...draftFor(request(), new Date(NOW - 3_600_000)),
    result: 'verified',
    sourceAuthority: 'RETHUS',
    sourceJurisdiction: 'CO',
    sourceReference: 'TP-12345',
    sourceStatus: 'Vigente',
    ...overrides,
  }
}

describe('credential verification presentation rules', () => {
  test('starts with no result, and the method only as a suggestion', () => {
    const draft = draftFor(request({ suggested_method: 'issuer_confirmation' }))

    expect(draft.result).toBeUndefined()
    expect(draft.method).toBe('issuer_confirmation')
    expect(draft.sourceValidTo).toBe('')
  })

  test('refuses to send a decision without a result', () => {
    expect(decisionIssue(completed({ result: undefined }), NOW)).toBe('result')
    expect(decisionIssueMessage('result')).toContain('No hay uno por defecto')
  })

  test('refuses a decision that does not name its source', () => {
    for (const field of [
      'sourceAuthority',
      'sourceJurisdiction',
      'sourceReference',
      'sourceStatus',
    ] as const) {
      expect(decisionIssue(completed({ [field]: '   ' }), NOW)).toBe('source')
    }
    expect(decisionIssue(completed({ sourceCheckedAt: '2027-01-01T00:00' }), NOW)).toBe('checked')
    expect(decisionIssue(completed(), NOW)).toBeUndefined()
  })

  test('a lapsed source cannot verify, but can still be recorded otherwise', () => {
    const lapsed = { sourceValidTo: '2020-01-01T00:00' }

    expect(decisionIssue(completed({ ...lapsed, result: 'verified' }), NOW)).toBe('lapsed')
    expect(decisionIssue(completed({ ...lapsed, result: 'rejected' }), NOW)).toBeUndefined()
    expect(decisionIssue(completed({ ...lapsed, result: 'unverifiable' }), NOW)).toBeUndefined()
  })

  test('sends no validity, policy or fingerprint — the server derives all three', () => {
    const body = toDecision('019aa000-0000-7000-8000-000000000501', 'verified', completed())

    expect(body.result).toBe('verified')
    expect(body.method).toBe('official_registry_lookup')
    expect(body.source_valid_to).toBeNull()
    for (const derived of ['valid_to', 'valid_from', 'policy_code', 'evidence_fingerprint']) {
      expect(body).not.toHaveProperty(derived)
    }
  })

  test('gives the three outcomes equal standing and not-verifiable no failure tone', () => {
    expect(VERIFICATION_RESULTS).toEqual(['verified', 'rejected', 'unverifiable'])
    expect(resultTone('verified')).toBe('success')
    expect(resultTone('rejected')).toBe('destructive')
    expect(resultTone('unverifiable')).toBe('secondary')
    expect(resultExplanation('unverifiable')).toContain('no un error')
    expect(resultLabel('unverifiable')).toBe('No verificable')
  })

  test('says what the validity will be, and that it cannot be longer', () => {
    expect(validitySentence()).toContain('12 meses')
    expect(validitySentence()).toContain('No se puede pedir una vigencia más larga')
  })

  test('a verification says until when, and that nothing else changed', () => {
    const verified = decisionSuccess({
      request_id: 'r',
      kind: 'initial',
      status: 'resolved',
      credential_id: 'c',
      created_at: '2026-09-12T15:00:00.000Z',
      resolved_at: '2026-09-13T15:00:00.000Z',
      verification: {
        id: 'v',
        result: 'verified',
        method: 'official_registry_lookup',
        decided_at: '2026-09-13T15:00:00.000Z',
        valid_from: '2026-09-13T15:00:00.000Z',
        valid_to: '2027-09-13T15:00:00.000Z',
      },
    })

    expect(verified).toContain('Verificado hasta el')
    expect(verified).toContain('Ningún otro dato de esta persona queda verificado')
  })

  test('explains a conflict and a renewal in words', () => {
    expect(conflictSentence()).toContain('compartes un gimnasio activo')
    expect(kindLabel('renewal')).toBe('Renovación')
    expect(methodLabel('issuer_confirmation')).toBe('Confirmación con quien lo emitió')
    expect(
      previousSentence(
        request({ previous_result: 'verified', previous_valid_to: '2026-08-13T15:00:00.000Z' }),
      ),
    ).toContain('Esa decisión no cambia')
    expect(previousSentence(request())).toBeNull()
  })

  test('says whether a renewal is overdue or only close', () => {
    const due = {
      credential_id: 'c',
      credential_type_code: 'academic_degree',
      credential_type_name: 'Título académico',
      credential_name: 'Fisioterapia',
      issuer: 'Universidad Nacional',
      holder_person_id: 'p',
      holder_given_name: 'Valentina',
      holder_family_name: 'Ríos',
    }

    expect(renewalSentence({ ...due, last_valid_to: '2026-09-01T00:00:00.000Z' }, NOW)).toContain(
      'Venció',
    )
    expect(renewalSentence({ ...due, last_valid_to: '2026-09-30T00:00:00.000Z' }, NOW)).toContain(
      'Vence',
    )
  })

  test('explains a request decided elsewhere and an expired duty', () => {
    expect(verificationMessage('conflict')).toContain('ya no está pendiente')
    expect(verificationMessage('forbidden')).toContain('vencen por diseño')
    expect(verificationMessage('anything-else')).toBe('No se pudo completar la operación.')
  })
})
