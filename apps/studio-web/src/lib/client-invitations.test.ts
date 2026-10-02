import { describe, expect, test } from 'bun:test'

import { canInviteClients, invitationBody, toggleScope, validateDraft } from './client-invitations'
import type { OfferableScope, OrganizationRole } from './studio-api'

function role(code: string, capabilities: string[]): OrganizationRole {
  return {
    code,
    name: code,
    capabilities: capabilities.map((capability) => ({ code: capability, name: capability })),
    fitness_data_access_policy: 'not_granted_by_role',
  } as OrganizationRole
}

const OWNER = role('owner', ['invite_clients', 'view_directory'])
const STAFF = role('staff', ['view_directory'])

function scope(code: string, name: string): OfferableScope {
  return {
    scope_definition_id: `0199f000-0000-7000-8000-00000000000${code.length % 10}`,
    scope_code: code,
    version_number: 1,
    display_name: name,
    description: `Qué cubre ${name}. No incluye otras cosas.`,
    default_purpose: `Por qué pedimos ${name}.`,
  } as OfferableScope
}

const CATALOG: OfferableScope[] = [
  scope('relationship_training', 'Entrenamiento con nosotros'),
  scope('body_progress', 'Progreso corporal'),
  scope('health_context', 'Contexto de salud'),
]

describe('who may invite', () => {
  test('a role carrying the capability may', () => {
    expect(canInviteClients(['owner'], [OWNER])).toBe(true)
  })

  test('a role that only reads the directory may not', () => {
    expect(canInviteClients(['staff'], [STAFF])).toBe(false)
  })

  test('nobody may while the catalog is still unknown', () => {
    expect(canInviteClients(['owner'], undefined)).toBe(false)
  })
})

describe('what the form refuses to send', () => {
  test('an empty address', () => {
    expect(validateDraft({ contact: '  ', scopeCodes: ['body_progress'] }).contact).toBeTruthy()
  })

  test('something that is not an address', () => {
    expect(validateDraft({ contact: 'ana', scopeCodes: ['body_progress'] }).contact).toBeTruthy()
  })

  /*
   * An invitation asking for nothing would create a relationship that grants
   * access to nothing — which is a legitimate *outcome* of someone declining,
   * but never a legitimate thing to send.
   */
  test('an invitation that asks for nothing', () => {
    expect(validateDraft({ contact: 'ana@example.test', scopeCodes: [] }).scopes).toBeTruthy()
  })

  test('and accepts a complete draft', () => {
    expect(validateDraft({ contact: 'ana@example.test', scopeCodes: ['body_progress'] })).toEqual(
      {},
    )
  })
})

describe('the body it builds', () => {
  const draft = { contact: '  Ana@Example.test ', scopeCodes: ['body_progress'] }

  test('lower-cases and trims the address', () => {
    expect(invitationBody(draft, CATALOG).contact).toBe('ana@example.test')
  })

  test('sends only the scopes that were ticked', () => {
    const body = invitationBody(draft, CATALOG)
    expect(body.scopes).toHaveLength(1)
    expect(body.scopes[0]?.scope_code).toBe('body_progress')
  })

  /*
   * The glossary is explicit that three of the seven never admit professional
   * writing, and the rest take `contribute` only on a further explicit
   * acceptance. The form never offers the choice, so this is the assertion that
   * keeps it that way.
   */
  test('always asks to read, never to write', () => {
    const everything = { contact: 'ana@example.test', scopeCodes: CATALOG.map((s) => s.scope_code) }
    const body = invitationBody(everything, CATALOG)
    expect(body.scopes.every((entry) => entry.access_level === 'read')).toBe(true)
  })

  test('takes the purpose from the catalogue, never from the screen', () => {
    const body = invitationBody(draft, CATALOG)
    expect(body.scopes[0]?.purpose).toBe('Por qué pedimos Progreso corporal.')
  })

  test('freezes what the person will read into the snapshot', () => {
    const snapshot = invitationBody(draft, CATALOG).scopes[0]?.presented_snapshot
    expect(snapshot).toMatchObject({
      display_name: 'Progreso corporal',
      version_number: 1,
    })
  })

  test('a code nobody offers cannot be smuggled in', () => {
    const body = invitationBody({ contact: 'ana@example.test', scopeCodes: ['invented'] }, CATALOG)
    expect(body.scopes).toEqual([])
  })
})

describe('ticking scopes', () => {
  test('adds one', () => {
    expect(toggleScope([], 'body_progress', CATALOG)).toEqual(['body_progress'])
  })

  test('removes one already ticked', () => {
    expect(toggleScope(['body_progress'], 'body_progress', CATALOG)).toEqual([])
  })

  /*
   * Catalogue order, not click order. The invitation records the scopes in the
   * order they are sent, and two professionals ticking the same three boxes in
   * different orders should produce the same offer — otherwise the reuse check
   * in the command sees two different proposals.
   */
  test('keeps catalogue order whatever order they were ticked', () => {
    let chosen = toggleScope([], 'health_context', CATALOG)
    chosen = toggleScope(chosen, 'relationship_training', CATALOG)
    expect(chosen).toEqual(['relationship_training', 'health_context'])
  })
})
