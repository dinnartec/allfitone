import { describe, expect, test } from 'bun:test'

import {
  EMPTY_FILTERS,
  accessLogMessage,
  answerSentence,
  filterIssue,
  filterIssueMessage,
  hasWithheld,
  isExceptional,
  modeBasis,
  modeLabel,
  modeTone,
  resultLabel,
  toQuery,
  type AccessEvent,
  type AccessEventPage,
} from './access-log'

const ACTOR = '019a9000-0000-7000-8000-000000000004'
const SUBJECT = '019a9000-0000-7000-8000-000000000006'

function event(overrides: Partial<AccessEvent> = {}): AccessEvent {
  return {
    actor_person_id: ACTOR,
    subject_person_id: SUBJECT,
    resource: 'support.person_operational_state',
    resource_id: null,
    purpose: 'customer_support_request',
    result: 'allowed',
    scope_code: null,
    scope_version: null,
    access_mode: 'organization_operational',
    occurred_at: '2026-09-10T18:00:00.000Z',
    ...overrides,
  }
}

function page(overrides: Partial<AccessEventPage> = {}): AccessEventPage {
  return { items: [event()], withheld_from_you: 0, ...overrides }
}

describe('access log presentation rules', () => {
  test('refuses an unfiltered query rather than paging the whole log', () => {
    // Reading the whole log is not auditing. Every row is about a real person.
    expect(filterIssue(EMPTY_FILTERS)).toBe('unfiltered')
    expect(filterIssueMessage('unfiltered')).toContain('no se navega')

    expect(filterIssue({ ...EMPTY_FILTERS, subjectPersonId: SUBJECT })).toBeUndefined()
    expect(filterIssue({ ...EMPTY_FILTERS, actorPersonId: ACTOR })).toBeUndefined()
    expect(
      filterIssue({ ...EMPTY_FILTERS, from: '2026-09-01T00:00', to: '2026-09-10T00:00' }),
    ).toBeUndefined()
  })

  test('refuses a malformed identifier instead of sending it', () => {
    expect(filterIssue({ ...EMPTY_FILTERS, actorPersonId: 'alguien' })).toBe('actor')
    expect(filterIssue({ ...EMPTY_FILTERS, subjectPersonId: '019a9000' })).toBe('subject')
    // An inverted range would come back empty and read as "nobody looked".
    expect(
      filterIssue({ ...EMPTY_FILTERS, from: '2026-09-10T00:00', to: '2026-09-01T00:00' }),
    ).toBe('range')
  })

  test('sends only the filters that were filled in', () => {
    const query = toQuery({
      actorPersonId: `  ${ACTOR}  `,
      subjectPersonId: '',
      from: '2026-09-01T00:00',
      to: '',
    })

    expect(query.actor_person_id).toBe(ACTOR)
    expect(query.subject_person_id).toBeUndefined()
    expect(query.from).toBe(new Date('2026-09-01T00:00').toISOString())
    expect(query.to).toBeUndefined()
  })

  test('states the whole answer, withheld records included', () => {
    expect(answerSentence(page())).toBe('1 acceso en total.')
    expect(answerSentence(page({ items: [event(), event()] }))).toBe('2 accesos en total.')
    expect(answerSentence(page({ items: [], withheld_from_you: 0 }))).toContain('No hay ningún')

    const partial = answerSentence(page({ withheld_from_you: 2 }))
    expect(partial).toContain('1 acceso')
    expect(partial).toContain('2 accesos más que no te corresponde auditar')
    expect(partial).toContain('pásale el caso a otra persona')
    expect(hasWithheld(page({ withheld_from_you: 2 }))).toBe(true)
  })

  test('an empty list with withheld records never reads as "nobody looked"', () => {
    // The failure this exists to prevent: an auditor filters down to a window they
    // requested themselves, sees nothing, and reports that nobody accessed the data.
    const answer = answerSentence(page({ items: [], withheld_from_you: 1 }))

    expect(answer).toContain('1 acceso')
    expect(answer).toContain('pediste o aprobaste')
    expect(answer).toContain('no responde la pregunta')
    expect(answer).not.toContain('No hay ningún')
  })

  test('tells an exceptional access apart from an ordinary one', () => {
    expect(isExceptional(event({ access_mode: 'break_glass' }))).toBe(true)
    expect(isExceptional(event({ access_mode: 'live' }))).toBe(false)
    expect(modeTone('break_glass')).toBe('destructive')
    expect(modeTone('frozen')).toBe('warning')
    expect(modeTone('live')).toBe('secondary')
    expect(modeTone('organization_operational')).toBe('secondary')
    expect(modeLabel('break_glass')).toBe('Acceso excepcional')
  })

  test("sets a read by Allfit staff apart from the person's own permissions", () => {
    // A verifier or a support operator reads under a duty, not a grant. Shown as a
    // live permission, the log would tell an auditor the person consented.
    expect(modeLabel('support_metadata')).toBe('Lectura del equipo de Allfit')
    expect(modeTone('support_metadata')).toBe('warning')
    expect(modeBasis('support_metadata')).toContain('No hubo permiso de la persona')
    expect(modeBasis('support_metadata')).not.toContain('permiso vigente')
  })

  test('explains the basis for the read rather than naming the mode', () => {
    expect(modeBasis('break_glass')).toContain('ventana excepcional aprobada por otra persona')
    expect(modeBasis('frozen')).toContain('histórico que quedó congelado')
    expect(modeBasis('live')).toContain('permiso vigente')
    expect(modeBasis('organization_operational')).toContain('no una lectura de datos de salud')
  })

  test('a denied attempt is shown as recorded evidence, not as a gap', () => {
    expect(resultLabel('allowed')).toBe('Entregó contenido')
    expect(resultLabel('denied')).toBe('Denegado y registrado')
  })

  test('explains a refusal as an expired duty rather than a mistake', () => {
    expect(accessLogMessage('forbidden')).toContain('vencen por diseño')
    // A rejected filter is explained by what ignoring it would have done.
    expect(accessLogMessage('invalid-request')).toContain('ampliaría la consulta')
    expect(accessLogMessage('anything-else')).toBe('No se pudo completar la consulta.')
  })
})
