import { describe, expect, test } from 'bun:test'

import {
  EMPTY_DIRECTORY_FILTERS,
  ORGANIZATION_STATUSES,
  directoryAnswer,
  directoryFilterIssue,
  directoryFilterIssueMessage,
  directoryMessage,
  hasUnknownPeopleServed,
  peopleServedLabel,
  statusLabel,
  statusMeaning,
  statusTone,
  toDirectoryQuery,
  type OrganizationSummary,
} from './organization-directory'

function organization(overrides: Partial<OrganizationSummary> = {}): OrganizationSummary {
  return {
    organization_id: '019a6000-0000-7000-8000-000000000001',
    display_name: 'Gimnasio Norte',
    type_code: 'gym',
    type_name: 'Gimnasio',
    status: 'active',
    created_at: '2026-08-04T15:00:00.000Z',
    claimed_at: '2026-08-04T15:00:00.000Z',
    cancelled_at: null,
    active_member_count: 1,
    site_count: 2,
    people_served: null,
    ...overrides,
  }
}

describe('organization directory presentation', () => {
  test('an unclaimed organization never reads like one that operates', () => {
    expect(statusLabel('unclaimed')).not.toBe(statusLabel('active'))
    expect(statusTone('unclaimed')).not.toBe(statusTone('active'))
    expect(statusMeaning('unclaimed')).toContain('no opera')
  })

  test('every lifecycle state has a label, a meaning and a tone', () => {
    for (const status of ORGANIZATION_STATUSES) {
      expect(statusLabel(status)).not.toBe('')
      expect(statusMeaning(status)).not.toBe('')
      expect(['success', 'warning', 'secondary']).toContain(statusTone(status))
    }
  })

  test('an unknown number of people served is never printed as zero', () => {
    expect(peopleServedLabel(null)).toBe('Sin dato aún')
    expect(peopleServedLabel(0)).toBe('0 personas')
    expect(peopleServedLabel(1)).toBe('1 persona')
    expect(hasUnknownPeopleServed([organization()])).toBe(true)
    expect(hasUnknownPeopleServed([organization({ people_served: 0 })])).toBe(false)
  })

  test('a one-letter search is refused before it becomes a query', () => {
    expect(directoryFilterIssue({ query: ' n ', status: 'any' })).toBe('short-query')
    expect(directoryFilterIssue({ query: 'x'.repeat(121), status: 'any' })).toBe('long-query')
    expect(directoryFilterIssue({ query: 'no', status: 'any' })).toBeUndefined()
    expect(directoryFilterIssue(EMPTY_DIRECTORY_FILTERS)).toBeUndefined()
    expect(directoryFilterIssueMessage('short-query')).toContain('dos letras')
  })

  test('sends only the filters that were filled in', () => {
    expect(toDirectoryQuery(EMPTY_DIRECTORY_FILTERS)).toEqual({})
    expect(toDirectoryQuery({ query: '  norte ', status: 'unclaimed' }, 'cursor-value')).toEqual({
      q: 'norte',
      status: 'unclaimed',
      cursor: 'cursor-value',
    })
  })

  test('a partial page says there is more, and an empty one says why it is empty', () => {
    expect(directoryAnswer(25, true, EMPTY_DIRECTORY_FILTERS)).toContain('Hay más')
    expect(directoryAnswer(1, false, EMPTY_DIRECTORY_FILTERS)).toBe('1 gimnasio.')
    expect(directoryAnswer(0, false, { query: 'norte', status: 'any' })).toContain('coincide')
    expect(directoryAnswer(0, false, EMPTY_DIRECTORY_FILTERS)).toContain('Todavía no hay')
  })

  test('a withdrawn duty is explained as expiry by design', () => {
    expect(directoryMessage('forbidden')).toContain('vencen por diseño')
    expect(directoryMessage('something-new')).toBe('No se pudo leer el directorio.')
  })
})
