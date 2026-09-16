import { describe, expect, test } from 'bun:test'

import {
  ACCESS_LEVELS,
  SCOPE_CODES,
  actionLabel,
  classificationLabel,
  effectiveVersion,
  emptyRule,
  excludedRules,
  groupByScope,
  includedRules,
  includesSomething,
  ruleIssue,
  ruleIssueMessage,
  scopeDefinitionMessage,
  scopeLabel,
  toResourceRules,
  type ScopeDefinition,
} from './scope-definitions'

function definition(overrides: Partial<ScopeDefinition> = {}): ScopeDefinition {
  return {
    id: '019a7000-0000-7000-8000-000000000401',
    scope_code: 'body_progress',
    version_number: 1,
    status: 'published',
    published_at: '2026-09-10T18:00:00.000Z',
    rules: [
      {
        resource: 'execution.body_measurements',
        field: 'weight_kg',
        data_classification_code: 'body',
        max_action: 'read',
        is_excluded: false,
        historical_readable: true,
      },
      {
        resource: 'nutrition.intake_entries',
        field: '*',
        data_classification_code: 'nutrition',
        max_action: 'read',
        is_excluded: true,
        historical_readable: false,
      },
    ],
    ...overrides,
  }
}

describe('permission definition presentation rules', () => {
  test('names every scope and every action in the words a person would read', () => {
    const labels = SCOPE_CODES.map((code) => scopeLabel(code))
    expect(new Set(labels).size).toBe(SCOPE_CODES.length)
    expect(labels.every((label) => !label.includes('_'))).toBe(true)
    expect(ACCESS_LEVELS.map((action) => actionLabel(action))).toEqual([
      'Sólo leer',
      'Leer y aportar',
    ])
    expect(classificationLabel('health')).toBe('Salud')
    expect(classificationLabel('invented')).toBe('invented')
  })

  test('separates what a permission includes from what it excludes', () => {
    const version = definition()
    expect(includedRules(version)).toHaveLength(1)
    expect(excludedRules(version)).toHaveLength(1)
    expect(excludedRules(version)[0]?.resource).toBe('nutrition.intake_entries')
  })

  test('refuses a version that only excludes, because it grants nothing', () => {
    expect(includesSomething([{ ...emptyRule(), excluded: true }])).toBe(false)
    expect(includesSomething([{ ...emptyRule(), excluded: true }, emptyRule()])).toBe(true)
  })

  test('checks the shape of a resource and a field before the request travels', () => {
    const base = { ...emptyRule(), resource: 'execution.body_measurements', field: 'weight_kg' }
    expect(ruleIssue(base)).toBeUndefined()
    expect(ruleIssue({ ...base, field: '*' })).toBeUndefined()
    expect(ruleIssue({ ...base, resource: 'Execution.Body' })).toBe('resource-shape')
    expect(ruleIssue({ ...base, field: 'Weight KG' })).toBe('field-shape')
  })

  test('refuses reading backwards on something the permission excludes', () => {
    const base = { ...emptyRule(), resource: 'execution.body_measurements', field: 'weight_kg' }
    expect(ruleIssue({ ...base, excluded: true, historical: true })).toBe('historical-on-excluded')
    expect(ruleIssue({ ...base, action: 'contribute', historical: true })).toBe(
      'historical-needs-read',
    )
    expect(ruleIssueMessage('historical-on-excluded')).toContain('excluido')
  })

  test('sends both flags explicitly rather than leaving them to a default', () => {
    const [rule] = toResourceRules([
      { ...emptyRule(), resource: 'execution.body_measurements', field: ' weight_kg ' },
    ])
    expect(rule?.field).toBe('weight_kg')
    expect(rule?.is_excluded).toBe(false)
    expect(rule?.historical_readable).toBe(false)
  })

  test('keeps every version of a scope, newest first', () => {
    const histories = groupByScope([
      definition({ version_number: 1, id: 'a' }),
      definition({ version_number: 3, id: 'c' }),
      definition({ version_number: 2, id: 'b' }),
      definition({ scope_code: 'health_context', id: 'd' }),
    ])

    expect(histories).toHaveLength(2)
    const body = histories.find((history) => history.code === 'body_progress')
    expect(body?.versions.map((version) => version.version_number)).toEqual([3, 2, 1])
    // An older version is not dropped: somebody is still living under it.
    expect(body?.versions).toHaveLength(3)
  })

  test('names the newest version without calling the others obsolete', () => {
    const histories = groupByScope([
      definition({ version_number: 1, id: 'a' }),
      definition({ version_number: 2, id: 'b' }),
    ])
    const history = histories[0]
    expect(history).toBeDefined()
    expect(history && effectiveVersion(history)?.version_number).toBe(2)
  })

  test('answers the immutability guard with the next action, never a retry', () => {
    expect(scopeDefinitionMessage('conflict')).toContain('publica la versión siguiente')
    expect(scopeDefinitionMessage('conflict')).toContain('conserva')
    expect(scopeDefinitionMessage('forbidden')).toContain('vencen por diseño')
    expect(scopeDefinitionMessage('anything-else')).toBe(
      'No se pudo publicar la definición de permiso.',
    )
  })
})
