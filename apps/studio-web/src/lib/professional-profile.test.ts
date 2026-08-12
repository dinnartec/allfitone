import { describe, expect, test } from 'bun:test'

import {
  credentialStateLabel,
  groupCredentials,
  hasErrors,
  mergeSpecialtyCatalog,
  validateCredential,
  validateProfile,
} from './professional-profile.js'
import type { ProfessionalCredential } from './studio-api.js'

const publishedSpecialties = new Set(['personal_training', 'mobility_flexibility'])
const publishedTypes = new Set(['professional_certification'])

describe('professional profile validation', () => {
  test('accepts a complete personal profile', () => {
    expect(
      validateProfile(
        {
          headline: 'Entrenador de fuerza',
          bio: 'Acompaño procesos sostenibles.',
          practice_started_year: 2020,
          specialty_codes: ['personal_training'],
        },
        publishedSpecialties,
        2026,
      ),
    ).toEqual({})
  })

  test('rejects future years, duplicate and unpublished specialties', () => {
    const future = validateProfile(
      {
        headline: 'Entrenador',
        bio: 'Acompañamiento profesional.',
        practice_started_year: 2027,
        specialty_codes: ['personal_training', 'personal_training'],
      },
      publishedSpecialties,
      2026,
    )
    expect(future.practice_started_year).toBeDefined()
    expect(future.specialty_codes).toBeDefined()

    const unpublished = validateProfile(
      {
        headline: 'Entrenador',
        bio: 'Acompañamiento profesional.',
        practice_started_year: 2020,
        specialty_codes: ['legacy_specialty'],
      },
      publishedSpecialties,
      2026,
    )
    expect(unpublished.specialty_codes).toContain('Retira')
  })
})

describe('professional credential validation', () => {
  test('requires a published type, coherent dates and a safe HTTPS URL', () => {
    const errors = validateCredential(
      {
        credential_type_code: 'deprecated_type',
        issuer: 'Entidad',
        name: 'Certificación',
        issued_on: '2026-04-10',
        expires_on: '2025-04-10',
        verification_url: 'http://user:secret@example.com',
      },
      publishedTypes,
    )
    expect(errors.credential_type_code).toBeDefined()
    expect(errors.expires_on).toBeDefined()
    expect(errors.verification_url).toBeDefined()
    expect(hasErrors(errors)).toBe(true)
  })
})

describe('catalog and credential projections', () => {
  test('keeps historical specialties visible and marks them unavailable', () => {
    expect(
      mergeSpecialtyCatalog(
        [{ code: 'personal_training', name: 'Entrenamiento personal', description: null }],
        [{ code: 'legacy_specialty', name: 'Especialidad histórica', description: null }],
      ),
    ).toEqual([
      {
        code: 'personal_training',
        name: 'Entrenamiento personal',
        description: null,
        available: true,
      },
      {
        code: 'legacy_specialty',
        name: 'Especialidad histórica',
        description: null,
        available: false,
      },
    ])
  })

  test('groups active and retired credentials and prioritizes retirement label', () => {
    const active = credential('active', 'verified')
    const retired = credential('retired', 'verified')
    expect(groupCredentials([retired, active])).toEqual({ active: [active], retired: [retired] })
    expect(credentialStateLabel(active)).toBe('Verificada')
    expect(credentialStateLabel(retired)).toBe('Retirada')
  })

  test('maps every verification state without creating a global profile status', () => {
    expect(
      (['unverified', 'verified', 'expired', 'rejected', 'unverifiable', 'revoked'] as const).map(
        (state) => credentialStateLabel(credential('active', state)),
      ),
    ).toEqual([
      'No verificada',
      'Verificada',
      'Verificación vencida',
      'Verificación rechazada',
      'No verificable',
      'Verificación revocada',
    ])
  })
})

function credential(
  status: ProfessionalCredential['status'],
  verificationState: ProfessionalCredential['verification']['state'],
): ProfessionalCredential {
  return {
    id: `${status}-credential`,
    credential_type_code: 'professional_certification',
    credential_type_name: 'Certificación profesional',
    issuer: 'Allfit Academy',
    name: 'Entrenamiento personal',
    identifier: null,
    issued_on: null,
    expires_on: null,
    verification_url: null,
    status,
    supersedes_credential_id: null,
    created_at: '2026-08-10T12:00:00.000Z',
    retired_at: status === 'retired' ? '2026-08-10T13:00:00.000Z' : null,
    verification: {
      state: verificationState,
      valid_from: null,
      valid_to: null,
      effective: verificationState === 'verified',
    },
  }
}
