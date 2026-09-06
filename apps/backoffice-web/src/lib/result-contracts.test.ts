import { describe, expect, test } from 'bun:test'

import {
  ACTIVITY_FAMILIES,
  activityFamilyLabel,
  contractStatusLabel,
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
