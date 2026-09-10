import { describe, expect, test } from 'bun:test'

import {
  SUPPORT_LOOKUP_KINDS,
  absentBlocks,
  availabilityExplanation,
  availabilityLabel,
  isValidCaseReference,
  isValidLookup,
  lookupIssueMessage,
  lookupLabel,
  supportMetadataMessage,
  verificationLabel,
  type SupportPersonMetadata,
} from './support-metadata'

const metadata: SupportPersonMetadata = {
  person_id: '019a5000-0000-7000-8000-000000000005',
  account_status: 'active',
  created_at: '2026-01-04T10:00:00.000Z',
  activated_at: null,
  contact_email_masked: '••••••••on@example.test',
  contact_phone_masked: null,
  email_verified_at: '2026-01-05T10:05:00.000Z',
  phone_verified_at: null,
  has_access_account: true,
  access_account_linked_at: null,
  active_session_count: 0,
  last_seen_at: null,
  has_professional_profile: false,
  membership_count: 0,
  active_membership_count: 0,
  relationships_availability: 'not_modelled',
  plan_availability: 'not_modelled',
  premium_availability: 'not_modelled',
  permissions_availability: 'not_modelled',
}

describe('support metadata presentation rules', () => {
  test('offers exactly the three exact lookups, and no name', () => {
    expect(SUPPORT_LOOKUP_KINDS).toEqual(['identifier', 'email', 'phone'])
    expect(SUPPORT_LOOKUP_KINDS.map((kind) => lookupLabel(kind)).join(' ')).not.toContain('ombre')
  })

  test('accepts a structured case reference and refuses free prose', () => {
    expect(isValidCaseReference('CASE-2026-001')).toBe(true)
    expect(isValidCaseReference('  SUP-1234  ')).toBe(true)
    expect(isValidCaseReference('ZD-99887')).toBe(true)
    expect(isValidCaseReference('el usuario no puede entrar')).toBe(false)
    expect(isValidCaseReference('case-2026-001')).toBe(false)
    expect(isValidCaseReference('')).toBe(false)
  })

  test('checks each lookup against its own shape before it travels', () => {
    expect(isValidLookup('identifier', '019a5000-0000-7000-8000-000000000005')).toBe(true)
    expect(isValidLookup('identifier', 'not-a-uuid')).toBe(false)
    expect(isValidLookup('email', 'persona@ejemplo.com')).toBe(true)
    expect(isValidLookup('email', 'persona')).toBe(false)
    expect(isValidLookup('phone', '+573001234567')).toBe(true)
    expect(isValidLookup('phone', '573001234567')).toBe(false)
  })

  test('explains a malformed lookup in the terms of what was asked for', () => {
    const messages = SUPPORT_LOOKUP_KINDS.map((kind) => lookupIssueMessage(kind))
    expect(new Set(messages).size).toBe(SUPPORT_LOOKUP_KINDS.length)
    expect(lookupIssueMessage('phone')).toContain('+')
  })

  test('lists every absent block instead of hiding it', () => {
    const blocks = absentBlocks(metadata)
    expect(blocks).toHaveLength(4)
    expect(blocks.every((block) => block.availability === 'not_modelled')).toBe(true)
  })

  test('never lets an absent domain read as a fact about the person', () => {
    expect(availabilityLabel('not_modelled')).toContain('Allfit')
    expect(availabilityExplanation('not_modelled')).toContain(
      'no es una afirmación sobre la persona',
    )
    expect(availabilityExplanation('unknown')).toContain('Esta persona')
    expect(availabilityLabel('unknown')).not.toBe(availabilityLabel('not_modelled'))
  })

  test('tells a verified contact from an unverified one without inventing a date', () => {
    expect(verificationLabel('2026-01-05T10:05:00.000Z')).toBe('Verificado')
    expect(verificationLabel(null)).toBe('Sin verificar')
  })

  test('explains a refusal as an expired duty rather than a mistake', () => {
    expect(supportMetadataMessage('forbidden')).toContain('vencen por diseño')
    expect(supportMetadataMessage('not-found')).toContain('ninguna persona')
    expect(supportMetadataMessage('anything-else')).toBe(
      'No se pudo leer la información de soporte.',
    )
  })
})
