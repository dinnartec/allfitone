import { describe, expect, test } from 'bun:test'

import {
  createInvitationFlow,
  historyLine,
  invitationExpiry,
  pendingCovers,
  scopeTitle,
  sharedSummary,
  tokenFromLink,
  coverSpan,
  endedSpan,
  type InvitationTransport,
} from './gym-affiliation'

const INTENT = '019b3000-0000-7000-8000-000000000041'
const INVITATION = '019b3000-0000-7000-8000-000000000031'

function transport(overrides: Partial<InvitationTransport> = {}) {
  const keys: string[] = []
  const base: InvitationTransport = {
    listMine: async () => ({ data: [] }),
    readMine: async () => {
      throw new Error('not used')
    },
    resolve: async () => {
      throw new Error('not used')
    },
    decide: async (command) => {
      keys.push(command.idempotencyKey)
      return {
        invitation_id: INVITATION,
        invitation_status: 'completed',
        organization_id: 'org',
        invitation_intent_id: INTENT,
        intent_status: 'accepted',
        relationship_id: 'rel',
        granted_scope_codes: ['relationship_training'],
        replayed: false,
      }
    },
    ...overrides,
  }
  let issued = 0
  const flow = createInvitationFlow({
    transport: base,
    newCommand: () => {
      issued += 1
      return { idempotencyKey: `key-${issued}`, commandId: `command-${issued}` }
    },
  })
  return { flow, keys }
}

describe('a gym invitation, as Space says it', () => {
  test('T-SPC-UNIT-311 each category reads by its own title, or a plain name', () => {
    expect(
      scopeTitle({ scope_code: 'body_progress', presented_snapshot: { title: 'Progreso' } }),
    ).toBe('Progreso')
    expect(scopeTitle({ scope_code: 'health_context', presented_snapshot: {} })).toBe(
      'Dolor y limitaciones',
    )
  })

  test('T-SPC-UNIT-312 what she shares is counted out of what was asked', () => {
    expect(sharedSummary({ relationship_training: 'accepted', body_progress: 'rejected' }, 3)).toBe(
      'Compartes 1 de 3',
    )
    expect(sharedSummary({}, 0)).toBe('No pide ningún dato')
  })

  test('T-SPC-UNIT-313 the expiry reads as a date', () => {
    expect(invitationExpiry('2026-10-15T17:00:00.000Z')).toBe('vence el 15 oct')
  })

  test('T-SPC-UNIT-314 deciding by id, a retry reuses its command', async () => {
    let fail = true
    const { flow, keys } = transport({
      decide: async (command) => {
        keys.push(command.idempotencyKey)
        if (fail) {
          fail = false
          throw new Error('offline')
        }
        return {
          invitation_id: INVITATION,
          invitation_status: 'completed',
          organization_id: 'org',
          invitation_intent_id: INTENT,
          intent_status: 'accepted',
          relationship_id: 'rel',
          granted_scope_codes: [],
          replayed: false,
        }
      },
    })
    const decision = {
      invitation: { invitationId: INVITATION },
      intentId: INTENT,
      relationship: 'accepted' as const,
      scopes: {},
    }
    await expect(flow.decide(decision)).rejects.toThrow('offline')
    await flow.decide(decision)
    expect(keys).toEqual(['key-1', 'key-1'])
  })
})

describe('her gyms, as Space says them', () => {
  test('T-SPC-UNIT-315 only covers still waiting on her answer are asked about', () => {
    const covers = [
      { assignment_id: 'a', status: 'proposed', ends_on: '2099-01-01' },
      { assignment_id: 'b', status: 'active', ends_on: '2099-01-01' },
      { assignment_id: 'c', status: 'proposed', ends_on: '2000-01-01' },
    ]
    expect(
      pendingCovers(covers, new Date('2026-10-21T12:00:00Z')).map((cover) => cover.assignment_id),
    ).toEqual(['a'])
  })

  test('T-SPC-UNIT-316 each moment of the relationship reads as a sentence', () => {
    expect(historyLine({ type: 'relationship_started', detail: {} })).toBe(
      'Aceptaste la invitación',
    )
    expect(historyLine({ type: 'holder_assigned', detail: { display_name: 'Laura Gómez' } })).toBe(
      'Laura Gómez es tu coach',
    )
    expect(
      historyLine({ type: 'substitution_proposed', detail: { display_name: 'Daniel Mora' } }),
    ).toBe('Daniel Mora propone cubrirte')
    expect(historyLine({ type: 'relationship_ended', detail: { declared_by_us: true } })).toBe(
      'Terminaste la relación',
    )
    expect(historyLine({ type: 'relationship_ended', detail: { declared_by_us: false } })).toBe(
      'El gimnasio terminó la relación',
    )
    expect(
      historyLine({
        type: 'consent_decided',
        detail: { scope_code: 'body_progress', decision: 'accepted' },
      }),
    ).toBe('Compartiste medidas y fotos')
  })
})

describe('tokenFromLink', () => {
  test('T-SPC-UNIT-318 the token is read from the fragment, never from the query', () => {
    const token = 'A'.repeat(43)
    expect(tokenFromLink(`allfitspace://client-invitations#token=${token}`)).toBe(token)
    expect(tokenFromLink(`allfitspace://client-invitations?token=${token}`)).toBeUndefined()
    expect(tokenFromLink('allfitspace://client-invitations#token=')).toBeUndefined()
    expect(tokenFromLink(null)).toBeUndefined()
  })
})

describe('the lines of «Tus gimnasios»', () => {
  test('T-SPC-UNIT-319 a cover reads its dates, and a day is never shifted by the zone', () => {
    expect(coverSpan({ valid_from: '2026-10-06T15:00:00Z', ends_on: '2026-10-20' })).toBe(
      'del 6 oct al 20 oct',
    )
    expect(coverSpan({ valid_from: '2026-10-06T15:00:00Z', ends_on: null })).toBe('desde el 6 oct')
  })

  test('T-SPC-UNIT-320 an ended relationship says that they see nothing new', () => {
    expect(
      endedSpan({ started_at: '2026-02-04T15:00:00Z', ended_at: '2026-06-03T15:00:00Z' }),
    ).toBe('Del 4 feb al 3 jun · ya no ven nada nuevo')
  })
})
