import { describe, expect, test } from 'bun:test'

import {
  ACTIVITY_FAMILIES,
  activityFamilyLabel,
  catalogueReadMessage,
  contractStatusLabel,
  effectiveContractLabel,
  groupActivityTypes,
  emptyFixtures,
  fixtureIssue,
  fixtureIssueMessage,
  fixturesDemonstrateBothOutcomes,
  isValidActivityTypeId,
  isValidContractCode,
  parseJsonDocument,
  resultContractMessage,
  toContractFixtures,
} from './result-contracts'

describe('result contract publication rules', () => {
  test('names every activity family the contract accepts', () => {
    expect(ACTIVITY_FAMILIES).toEqual(['strength', 'endurance', 'interval', 'mobility'])
    const labels = ACTIVITY_FAMILIES.map((family) => activityFamilyLabel(family))
    expect(new Set(labels).size).toBe(ACTIVITY_FAMILIES.length)
  })

  test('tells a published version apart from a deprecated one', () => {
    expect(contractStatusLabel('published')).not.toBe(contractStatusLabel('deprecated'))
  })

  test('accepts only the closed shape of a contract code', () => {
    expect(isValidContractCode('strength.detailed')).toBe(true)
    expect(isValidContractCode('a_b.c1')).toBe(true)
    expect(isValidContractCode('Strength.Detailed')).toBe(false)
    expect(isValidContractCode('1strength')).toBe(false)
    expect(isValidContractCode('s')).toBe(false)
    expect(isValidContractCode('strength detailed')).toBe(false)
  })

  test('accepts only a well formed activity type identifier', () => {
    expect(isValidActivityTypeId('019a5000-0000-7000-8000-000000000301')).toBe(true)
    expect(isValidActivityTypeId('019a5000')).toBe(false)
  })

  test('accepts a JSON object and refuses everything else', () => {
    expect(parseJsonDocument('{"sets":1}')).toEqual({ ok: true, value: { sets: 1 } })
    expect(parseJsonDocument('{')).toEqual({ ok: false, reason: 'malformed' })
    expect(parseJsonDocument('[1,2]')).toEqual({ ok: false, reason: 'not-an-object' })
    expect(parseJsonDocument('7')).toEqual({ ok: false, reason: 'not-an-object' })
    expect(parseJsonDocument('null')).toEqual({ ok: false, reason: 'not-an-object' })
  })

  test('starts a publication with one passing and one failing case', () => {
    const drafts = emptyFixtures()
    expect(fixturesDemonstrateBothOutcomes(drafts)).toBe(true)
    expect(drafts.map((draft) => draft.kind)).toEqual(['valid', 'invalid'])
  })

  test('refuses a suite that never demonstrates a refusal', () => {
    expect(
      fixturesDemonstrateBothOutcomes([
        { kind: 'valid', payload: '{}', expected: 'accepted' },
        { kind: 'valid', payload: '{}', expected: 'accepted' },
      ]),
    ).toBe(false)
    expect(
      fixturesDemonstrateBothOutcomes([{ kind: 'invalid', payload: '{}', expected: 'no' }]),
    ).toBe(false)
  })

  test('reports what is wrong with a single case', () => {
    expect(fixtureIssue({ kind: 'valid', payload: '{}', expected: 'accepted' })).toBeUndefined()
    expect(fixtureIssue({ kind: 'valid', payload: '{', expected: 'accepted' })).toBe(
      'payload-malformed',
    )
    expect(fixtureIssue({ kind: 'valid', payload: '[]', expected: 'accepted' })).toBe(
      'payload-not-an-object',
    )
    expect(fixtureIssue({ kind: 'valid', payload: '{}', expected: '   ' })).toBe('expected-missing')
    expect(fixtureIssue({ kind: 'valid', payload: '{}', expected: 'x'.repeat(201) })).toBe(
      'expected-too-long',
    )
  })

  test('explains every case issue in the operator vocabulary', () => {
    const issues = [
      'payload-malformed',
      'payload-not-an-object',
      'expected-missing',
      'expected-too-long',
    ] as const
    const messages = issues.map((issue) => fixtureIssueMessage(issue))
    expect(new Set(messages).size).toBe(issues.length)
  })

  test('sends the parsed case payload and a trimmed expectation', () => {
    expect(
      toContractFixtures([
        { kind: 'invalid', payload: '{"sets":0}', expected: '  below_minimum ' },
      ]),
    ).toEqual([{ kind: 'invalid', payload: { sets: 0 }, expected: 'below_minimum' }])
  })

  test('answers a refusal with the next action, not with a retry', () => {
    expect(resultContractMessage('conflict')).toContain('publica la versión siguiente')
    expect(resultContractMessage('forbidden')).toContain('curaduría del catálogo')
    expect(resultContractMessage('not-found')).toContain('catálogo global')
    expect(resultContractMessage('anything-else')).toBe('No se pudo publicar el contrato.')
  })
})

describe('the global catalogue as the operator reads it', () => {
  const activityTypes = [
    { id: 'a', discipline_code: 'strength', code: 'squat', name: 'Sentadilla' },
    { id: 'b', discipline_code: 'endurance', code: 'run', name: 'Carrera' },
    { id: 'c', discipline_code: 'strength', code: 'bench', name: 'Press banca' },
  ]

  test('groups the picker by discipline, in the name the operator reads', () => {
    const groups = groupActivityTypes(activityTypes, [
      { code: 'strength', name: 'Fuerza' },
      { code: 'endurance', name: 'Resistencia' },
    ])

    expect(groups.map((group) => group.disciplineName)).toEqual(['Fuerza', 'Resistencia'])
    expect(groups[0]?.activityTypes.map((activityType) => activityType.id)).toEqual(['a', 'c'])
    expect(groups[1]?.activityTypes.map((activityType) => activityType.id)).toEqual(['b'])
  })

  test('keeps a type whose discipline has no label instead of hiding it', () => {
    const groups = groupActivityTypes(activityTypes, [{ code: 'strength', name: 'Fuerza' }])

    expect(groups.flatMap((group) => group.activityTypes)).toHaveLength(activityTypes.length)
    expect(groups.map((group) => group.disciplineName).sort()).toEqual(['Fuerza', 'endurance'])
  })

  test('says which effective contract is the default one', () => {
    const contract = {
      result_contract_id: '019f0000-0000-7000-8000-000000000101',
      contract_code: 'strength.detailed',
      version_number: 2,
      activity_family: 'strength' as const,
      contract_schema_version: 1 as const,
      envelope: {},
      minimums: {},
      is_default: true,
      valid_from: '2026-09-09T12:00:00.000Z',
    }

    expect(effectiveContractLabel(contract)).toBe('strength.detailed v2 (por omisión)')
    expect(effectiveContractLabel({ ...contract, is_default: false })).toBe('strength.detailed v2')
  })

  test('explains a catalogue that will not load without blaming the publication', () => {
    expect(catalogueReadMessage('unauthenticated')).toContain('Vuelve a iniciar sesión')
    expect(catalogueReadMessage('network-unavailable')).toContain('conexión')
    expect(catalogueReadMessage('anything-else')).toContain('catálogo global')
    expect(catalogueReadMessage('anything-else')).not.toContain('publicar')
  })
})
