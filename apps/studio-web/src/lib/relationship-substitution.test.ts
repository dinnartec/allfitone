import { describe, expect, test } from 'bun:test'

import {
  canEndSubstitution,
  canProposeSubstitution,
  coversAvailable,
  proposalRefusalDescription,
  proposalRefusalFor,
  proposalRefusalTitle,
  seesEverySubstitution,
  terminationRefusalDescription,
  terminationRefusalFor,
  terminationRefusalTitle,
  todayAsCalendarDay,
  windowProblem,
  windowProblemMessage,
} from './relationship-substitution'
import type { OrganizationMembership } from './studio-api'

function member(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    membership_id: '019ad000-0000-7000-8000-000000000201',
    person_id: '019ad000-0000-7000-8000-000000000011',
    display_name: 'Camilo Restrepo',
    status: 'active',
    roles: ['coach'],
    joined_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as OrganizationMembership
}

const HOLDER = '019ad000-0000-7000-8000-000000000201'

describe('who may ask for cover', () => {
  /*
   * The rule that separates this from every other action on the card. No other
   * operation in the domain accepts the holder, so a screen that reused
   * `canAssignProfessionals` would hide the action from the one person who most
   * needs it — the one who knows they will be away.
   */
  test('lets the holder ask without the capability to assign anybody', () => {
    expect(
      canProposeSubstitution({
        isHolder: true,
        mayAssignProfessionals: false,
        relationshipActive: true,
        hasHolder: true,
      }),
    ).toBe(true)
  })

  test('lets an administrator ask for somebody else', () => {
    expect(
      canProposeSubstitution({
        isHolder: false,
        mayAssignProfessionals: true,
        relationshipActive: true,
        hasHolder: true,
      }),
    ).toBe(true)
  })

  test('offers nothing to a coach who neither holds nor may assign', () => {
    expect(
      canProposeSubstitution({
        isHolder: false,
        mayAssignProfessionals: false,
        relationshipActive: true,
        hasHolder: true,
      }),
    ).toBe(false)
  })

  // A cover stands in for a holder. Putting the first coach in charge is a
  // different operation, and the command refuses this one outright.
  test('offers nothing where nobody is in charge', () => {
    expect(
      canProposeSubstitution({
        isHolder: false,
        mayAssignProfessionals: true,
        relationshipActive: true,
        hasHolder: false,
      }),
    ).toBe(false)
  })

  test('offers nothing once the relationship has ended', () => {
    expect(
      canProposeSubstitution({
        isHolder: true,
        mayAssignProfessionals: true,
        relationshipActive: false,
        hasHolder: true,
      }),
    ).toBe(false)
  })
})

describe('who is offered as cover', () => {
  test('leaves out the holder, because covering yourself is not covering', () => {
    const list = coversAvailable(
      [member(), member({ membership_id: 'b', display_name: 'Elena Soto' })],
      HOLDER,
    )
    expect(list.map((entry) => entry.display_name)).toEqual(['Elena Soto'])
  })

  test('leaves out staff and anybody who left', () => {
    const list = coversAvailable(
      [
        member({ membership_id: 'b', display_name: 'Sara Staff', roles: ['staff'] }),
        member({ membership_id: 'c', display_name: 'Camila Fue', status: 'terminated' }),
        member({ membership_id: 'd', display_name: 'Elena Soto' }),
      ],
      HOLDER,
    )
    expect(list.map((entry) => entry.display_name)).toEqual(['Elena Soto'])
  })

  test('orders by name the way Spanish reads it', () => {
    const list = coversAvailable(
      [
        member({ membership_id: 'b', display_name: 'Zoe Ñandú' }),
        member({ membership_id: 'c', display_name: 'Ana Álvarez' }),
        member({ membership_id: 'd', display_name: 'Nora Núñez' }),
      ],
      HOLDER,
    )
    expect(list.map((entry) => entry.display_name)).toEqual([
      'Ana Álvarez',
      'Nora Núñez',
      'Zoe Ñandú',
    ])
  })
})

describe('the window the cover runs for', () => {
  const today = '2026-10-13'

  test('accepts a window that starts today and ends later', () => {
    expect(windowProblem('2026-10-13', '2026-10-20', today)).toBeNull()
  })

  test('refuses a cover with no end, and says what the date is for', () => {
    expect(windowProblem('2026-10-13', '', today)).toBe('missing-end')
    // The sentence has to carry the reason: the date is what stops the access,
    // so leaving it blank is not an empty field, it is a cover nobody switches
    // off.
    expect(windowProblemMessage('missing-end')).toContain('corta el acceso')
  })

  test('refuses a window with no start', () => {
    expect(windowProblem('', '2026-10-20', today)).toBe('missing-start')
  })

  test('refuses an end before the start', () => {
    expect(windowProblem('2026-10-20', '2026-10-13', today)).toBe('ends-before-start')
  })

  test('refuses a cover that would already be over', () => {
    expect(windowProblem('2026-10-01', '2026-10-12', today)).toBe('ends-in-past')
  })

  // The reader's own day, not UTC: a cover starting "today" in Bogotá must not
  // read as yesterday because the browser is five hours behind midnight.
  test('reads today in the reader’s own timezone', () => {
    expect(todayAsCalendarDay(new Date(2026, 9, 13, 23, 30))).toBe('2026-10-13')
    expect(todayAsCalendarDay(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05')
  })
})

describe('what the screen says when the command refuses', () => {
  /*
   * `409` means something different here than on the two sibling actions. Not
   * "somebody beat you to it" and not "there is nobody to take the client
   * from": this same cover is already waiting for an answer, which a partial
   * unique index enforces, so a double click lands here.
   */
  test('reads a conflict as a cover already waiting for an answer', () => {
    expect(proposalRefusalFor(409)).toBe('already-proposed')
    expect(proposalRefusalTitle('already-proposed')).toContain('ya está propuesta')
  })

  test('separates a refused window from an outage', () => {
    expect(proposalRefusalFor(422)).toBe('invalid-window')
    expect(proposalRefusalFor(undefined)).toBe('unavailable')
  })

  test('maps the two denials the command makes', () => {
    expect(proposalRefusalFor(403)).toBe('not-allowed')
    expect(proposalRefusalFor(404)).toBe('gone')
  })

  // Only the temporary one may invite a retry, and it says why retrying is
  // safe: nothing was written and nobody was asked.
  test('offers a retry only where nothing was written', () => {
    expect(proposalRefusalDescription('unavailable')).toContain('otra vez')
    expect(proposalRefusalDescription('already-proposed')).not.toContain('otra vez')
    expect(proposalRefusalDescription('not-allowed')).not.toContain('otra vez')
  })
})

describe('whether the list the reader sees is the whole list', () => {
  /*
   * Since STUDIO-94 the row policy shows a professional the covers of the
   * clients they hold, so for a holder an empty list really does mean there
   * are none. Saying "no ves" to them would hedge about something the screen
   * now knows.
   */
  test('is the whole list for the holder, who can now see every cover of theirs', () => {
    expect(seesEverySubstitution({ everyClient: false, isHolder: true })).toBe(true)
  })

  test('is the whole list for anybody who reads the directory', () => {
    expect(seesEverySubstitution({ everyClient: true, isHolder: false })).toBe(true)
  })

  // An accepted substitute reading the screen sees their own row and no other.
  test('is not the whole list for a reader who is neither', () => {
    expect(seesEverySubstitution({ everyClient: false, isHolder: false })).toBe(false)
  })
})

describe('quién puede cortar una suplencia', () => {
  /*
   * La asimetría, escrita como prueba. `OP-REL-004` acepta al titular y
   * `OP-REL-006` no: puede pedir que le cubran y no puede cancelarlo. Si
   * alguien lo «arregla» leyendo al titular en esta regla, el botón aparecerá
   * en pantalla para quien el comando va a rechazar.
   */
  test('el titular no puede, aunque sí pueda proponerla', () => {
    expect(
      canEndSubstitution({
        mayAssignProfessionals: false,
        relationshipActive: true,
        status: 'active',
      }),
    ).toBe(false)
  })

  test('quien puede asignar profesionales, sí', () => {
    expect(
      canEndSubstitution({
        mayAssignProfessionals: true,
        relationshipActive: true,
        status: 'active',
      }),
    ).toBe(true)
  })

  // Una propuesta sin responder no concede acceso que cortar. Retirarla es otra
  // operación y todavía no existe (STUDIO-150).
  test('una suplencia que nadie ha respondido no se termina', () => {
    expect(
      canEndSubstitution({
        mayAssignProfessionals: true,
        relationshipActive: true,
        status: 'proposed',
      }),
    ).toBe(false)
  })

  test('una que ya terminó tampoco', () => {
    expect(
      canEndSubstitution({
        mayAssignProfessionals: true,
        relationshipActive: true,
        status: 'ended',
      }),
    ).toBe(false)
  })

  test('ni en un vínculo que ya terminó', () => {
    expect(
      canEndSubstitution({
        mayAssignProfessionals: true,
        relationshipActive: false,
        status: 'active',
      }),
    ).toBe(false)
  })
})

describe('qué dice la pantalla cuando no se puede terminar', () => {
  test('un conflicto es que ya no está corriendo, no que alguien se adelantó', () => {
    expect(terminationRefusalFor(409)).toBe('already-ended')
    expect(terminationRefusalTitle('already-ended')).toContain('ya no está corriendo')
  })

  test('separa la negativa del fallo temporal', () => {
    expect(terminationRefusalFor(403)).toBe('not-allowed')
    expect(terminationRefusalFor(404)).toBe('gone')
    expect(terminationRefusalFor(undefined)).toBe('unavailable')
  })

  /*
   * Solo el fallo temporal invita a reintentar, y dice por qué es seguro: no se
   * escribió nada, así que la suplencia sigue corriendo exactamente igual.
   */
  test('ofrece reintentar solo donde no se escribió nada', () => {
    expect(terminationRefusalDescription('unavailable')).toContain('otra vez')
    expect(terminationRefusalDescription('already-ended')).not.toContain('otra vez')
    expect(terminationRefusalDescription('not-allowed')).not.toContain('otra vez')
  })

  // La negativa explica la asimetría en vez de dejar al lector adivinando por
  // qué el botón no estaba donde esperaba.
  test('la negativa explica que el titular propone pero no corta', () => {
    expect(terminationRefusalDescription('not-allowed')).toContain('no cortarlas')
  })
})
