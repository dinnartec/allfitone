import { describe, expect, test } from 'bun:test'

import {
  EMPTY_DIRECTORY_FILTERS,
  ORGANIZATION_STATUSES,
  directoryFiltersFromStatus,
  directoryAnswer,
  directoryFilterIssue,
  directoryFilterIssueMessage,
  directoryMessage,
  peopleServedLabel,
  statusFilterLabel,
  statusLabel,
  statusMeaning,
  statusTone,
  toDirectoryQuery,
} from './organization-directory'

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

  test('a closed filter says what it filters, including when it filters nothing', () => {
    expect(statusFilterLabel('any')).toBe('Todos')
    expect(statusFilterLabel('active')).toBe(statusLabel('active'))
    expect(statusFilterLabel('unclaimed')).toBe(statusLabel('unclaimed'))
  })

  test('the people a gym serves are counted, and one is not "1 personas"', () => {
    expect(peopleServedLabel(0)).toBe('0 personas')
    expect(peopleServedLabel(1)).toBe('1 persona')
    expect(peopleServedLabel(12)).toBe('12 personas')
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

  test('a link can open the directory already filtered, but only by a known state', () => {
    expect(directoryFiltersFromStatus('unclaimed')).toEqual({ query: '', status: 'unclaimed' })
    expect(directoryFiltersFromStatus('suspended')).toEqual({ query: '', status: 'suspended' })
    expect(directoryFiltersFromStatus('dormant')).toEqual(EMPTY_DIRECTORY_FILTERS)
    expect(directoryFiltersFromStatus(null)).toEqual(EMPTY_DIRECTORY_FILTERS)
  })
})
