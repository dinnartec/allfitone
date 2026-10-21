import { describe, expect, test } from 'bun:test'

import {
  endedElsewhereNote,
  endedReason,
  historyEventTitle,
  mentionsAProfessional,
  scopeLabel,
} from './relationship-history.js'
import type { RelationshipHistoryEvent } from './studio-api.js'

function event(
  type: RelationshipHistoryEvent['type'],
  detail: Record<string, unknown> = {},
): RelationshipHistoryEvent {
  return {
    type,
    occurred_at: '2026-10-02T08:00:00.000Z',
    source_id: '019c8000-0000-7000-8000-000000000801',
    detail,
  }
}

const ANA = 'Ana Cliente'

describe('what each moment says', () => {
  test('an opening says whether the person is new or coming back', () => {
    expect(historyEventTitle(event('relationship_started'), ANA)).toBe(`${ANA} entró como clienta`)
    expect(
      historyEventTitle(
        event('relationship_started', { continues_relationship_id: '019c-previous' }),
        ANA,
      ),
    ).toBe(`${ANA} volvió al gimnasio`)
  })

  /*
   * «Pasó a atenderla», never «pasó a ver sus datos». Being in charge grants no
   * access at all, and a timeline that blurred the two would undo the sentence
   * the relationship screen exists to say.
   */
  test('a change of professional never implies access to anything', () => {
    const assigned = historyEventTitle(event('holder_assigned', { display_name: 'Diana' }), ANA)
    expect(assigned).toBe('Diana pasó a atenderla')
    expect(assigned).not.toContain('datos')
    expect(assigned).not.toContain('acceso')
    expect(historyEventTitle(event('holder_ended', { display_name: 'Camilo' }), ANA)).toBe(
      'Camilo dejó de atenderla',
    )
  })

  test('a substitution reads as proposed, accepted and ended', () => {
    expect(historyEventTitle(event('substitution_proposed', { display_name: 'Elena' }), ANA)).toBe(
      'Se propuso a Elena como suplente',
    )
    expect(historyEventTitle(event('substitution_accepted', { display_name: 'Elena' }), ANA)).toBe(
      `${ANA} aceptó a Elena como suplente`,
    )
    expect(historyEventTitle(event('substitution_ended', { display_name: 'Elena' }), ANA)).toBe(
      'Terminó la suplencia de Elena',
    )
  })

  test('a consent names the permission in the words the person was shown', () => {
    expect(
      historyEventTitle(
        event('consent_decided', { scope_code: 'health_context', decision: 'accepted' }),
        ANA,
      ),
    ).toBe(`${ANA} concedió su contexto de salud`)
    expect(
      historyEventTitle(
        event('consent_decided', { scope_code: 'body_progress', decision: 'revoked' }),
        ANA,
      ),
    ).toBe(`${ANA} retiró su progreso corporal`)
  })

  test('taking a category back reads as withdrawing it, whether the relationship runs or ended', () => {
    expect(historyEventTitle(event('grant_revoked', { scope_code: 'nutrition_intake' }), ANA)).toBe(
      `${ANA} retiró lo que come`,
    )
  })

  /*
   * A scope that is not in the list still has to read as something. A renamed or
   * retired scope must not render an empty sentence in a record that is supposed
   * to survive the product changing around it.
   */
  test('a permission nobody has a name for still reads as a permission', () => {
    expect(scopeLabel('something_added_later')).toBe('el permiso «something_added_later»')
  })

  /*
   * An event the screen does not know about is not a crash and not a blank line.
   * Nothing emits one today; the point is that adding a kind on the server
   * should not break a screen that has not shipped yet.
   */
  test('every kind the contract declares has a sentence', () => {
    const kinds: RelationshipHistoryEvent['type'][] = [
      'relationship_started',
      'holder_assigned',
      'holder_ended',
      'substitution_proposed',
      'substitution_accepted',
      'substitution_ended',
      'consent_decided',
      'relationship_ended',
    ]
    for (const kind of kinds) {
      expect(historyEventTitle(event(kind), ANA).length).toBeGreaterThan(0)
    }
  })
})

describe('the reason a relationship ended', () => {
  test('is read when the organization declared it', () => {
    const ours = event('relationship_ended', {
      ended_by_kind: 'professional',
      declared_by_us: true,
      reason: 'Dejó de asistir sin avisar',
    })
    expect(historyEventTitle(ours, ANA)).toBe('El gimnasio cerró el vínculo')
    expect(endedReason(ours)).toBe('Dejó de asistir sin avisar')
    expect(endedElsewhereNote(ours)).toBeNull()
  })

  /*
   * The server withholds the person's reason, so `reason` arrives null. The
   * screen then has to say *why* there is nothing — otherwise it reads either as
   * «they said nothing» or as the product hiding something.
   */
  test('is not invented when the person declared it, and the silence is explained', () => {
    const theirs = event('relationship_ended', {
      ended_by_kind: 'person',
      declared_by_us: false,
      reason: null,
    })
    expect(historyEventTitle(theirs, ANA)).toBe(`${ANA} cerró el vínculo`)
    expect(endedReason(theirs)).toBeNull()
    expect(endedElsewhereNote(theirs)).toContain('es suyo')
  })

  test('says neither who nor why when it knows neither', () => {
    const unknown = event('relationship_ended', { ended_by_kind: 'support', declared_by_us: false })
    expect(historyEventTitle(unknown, ANA)).toBe('Se cerró el vínculo')
    expect(endedReason(unknown)).toBeNull()
  })
})

/*
 * A coach reads a shorter history than an owner, because the row policy shows
 * them only their own assignment. The screen needs to know which lines can go
 * missing so it can say so, rather than letting a short list read as the whole
 * story.
 */
describe('which moments a coach may not see', () => {
  test('are the ones that name another professional', () => {
    expect(mentionsAProfessional(event('holder_assigned'))).toBe(true)
    expect(mentionsAProfessional(event('substitution_ended'))).toBe(true)
    expect(mentionsAProfessional(event('consent_decided'))).toBe(false)
    expect(mentionsAProfessional(event('relationship_started'))).toBe(false)
  })
})
