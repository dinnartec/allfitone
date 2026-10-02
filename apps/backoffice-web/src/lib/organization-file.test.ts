import { describe, expect, test } from 'bun:test'

import {
  fileMessage,
  handsOverHere,
  memberCardHref,
  responsibleLabel,
  rolesLabel,
  peopleServedSentence,
  siteAddress,
  teamSentence,
  type OrganizationFile,
} from './organization-file'

const PERSON = '019a8000-0000-7000-8000-000000000006'

function file(overrides: Partial<OrganizationFile> = {}): OrganizationFile {
  return {
    organization: {
      organization_id: '019a8000-0000-7000-8000-000000000301',
      display_name: 'Ficha Norte',
      type_code: 'gym',
      type_name: 'Gimnasio',
      status: 'active',
      party_kind: 'legal_entity',
      legal_name: 'Norte Fitness SAS',
      created_at: '2026-06-01T12:00:00.000Z',
      claimed_at: '2026-06-01T12:00:00.000Z',
      cancelled_at: null,
    },
    owner: {
      person_id: PERSON,
      membership_id: '019a8000-0000-7000-8000-000000000311',
      since: '2026-06-01T12:00:00.000Z',
    },
    team: [],
    team_counts: { active: 3, terminated: 1 },
    team_truncated: false,
    sites: [],
    people_served: 0,
    relationship_counts: { active: 0, terminated: 0 },
    plans_availability: 'not_modelled',
    payment_method_availability: 'not_modelled',
    premium_availability: 'not_modelled',
    ...overrides,
  }
}

describe('organization file presentation', () => {
  test('names roles, never people', () => {
    expect(rolesLabel(['owner'])).toBe('Dueño')
    expect(rolesLabel(['admin', 'staff'])).toBe('Administrador · Staff')
    expect(rolesLabel([])).toBe('Sin rol vigente')
  })

  test('counts the team, former members included, and says when the list stops', () => {
    expect(teamSentence(file())).toBe('3 personas activas, y 1 que ya no está.')
    expect(teamSentence(file({ team_counts: { active: 1, terminated: 0 } }))).toBe(
      '1 persona activa.',
    )
    expect(
      teamSentence(file({ team_counts: { active: 250, terminated: 0 }, team_truncated: true })),
    ).toContain('primeras 200')
  })

  test('a gym nobody claimed has no team because it never had an owner', () => {
    const unclaimed = file({
      organization: { ...file().organization, status: 'unclaimed', claimed_at: null },
      owner: null,
      team_counts: { active: 0, terminated: 0 },
    })
    expect(teamSentence(unclaimed)).toContain('nunca tuvo dueño')
    expect(handsOverHere(unclaimed)).toBeTrue()
    expect(handsOverHere(file())).toBeFalse()
  })

  test('counts the people the gym serves and the relationships that ended', () => {
    expect(
      peopleServedSentence(
        file({ people_served: 12, relationship_counts: { active: 12, terminated: 3 } }),
      ),
    ).toBe('Atiende a 12 personas, y 3 relaciones ya terminaron.')
    expect(
      peopleServedSentence(
        file({ people_served: 1, relationship_counts: { active: 1, terminated: 0 } }),
      ),
    ).toBe('Atiende a 1 persona.')
  })

  test('a gym that serves nobody says so, because here zero is a fact', () => {
    expect(
      peopleServedSentence(
        file({ people_served: 0, relationship_counts: { active: 0, terminated: 0 } }),
      ),
    ).toBe('Todavía no atiende a nadie.')
    expect(
      peopleServedSentence(
        file({ people_served: 0, relationship_counts: { active: 0, terminated: 4 } }),
      ),
    ).toBe('No atiende a nadie en este momento, y 4 relaciones ya terminaron.')
  })

  test('a withheld address is said to be withheld, not missing', () => {
    expect(
      siteAddress({
        site_id: PERSON,
        name: 'Consultorio',
        address: null,
        address_withheld: true,
        status: 'active',
      }),
    ).toContain('Reservada')
    expect(
      siteAddress({
        site_id: PERSON,
        name: 'Sede',
        address: null,
        address_withheld: false,
        status: 'active',
      }),
    ).toBe('Sin dirección declarada')
  })

  test('an independent professional is never named as responsible', () => {
    const practice = file({
      organization: { ...file().organization, party_kind: 'natural_person', legal_name: null },
    })
    expect(responsibleLabel(practice)).toContain('no se muestra')
    expect(responsibleLabel(file())).toBe('Norte Fitness SAS')
  })

  test('a person card opens only with a traceable case reference', () => {
    expect(memberCardHref(PERSON, '')).toBeUndefined()
    expect(memberCardHref(PERSON, 'no es un caso')).toBeUndefined()
    expect(memberCardHref(PERSON, ' CASE-2026-013 ')).toBe(
      `/people/${PERSON}?case_reference=CASE-2026-013`,
    )
  })

  test('a withdrawn duty is explained as expiry by design', () => {
    expect(fileMessage('forbidden')).toContain('vencen por diseño')
    expect(fileMessage('unknown-code')).toBe('No se pudo abrir la ficha.')
  })
})
