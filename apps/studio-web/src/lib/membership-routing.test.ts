import { describe, expect, test } from 'bun:test'

import type { Membership } from './studio-api.js'
import { resolveMembershipDestination, resolveOrganizationContext } from './membership-routing.js'

function membership(id: string, status: Membership['status'] = 'active'): Membership {
  return {
    membership_id: `membership-${id}`,
    organization_id: `organization-${id}`,
    display_name: `Espacio ${id}`,
    type_code: 'studio',
    status,
    joined_at: '2026-08-09T12:00:00.000Z',
    roles: ['owner'],
  }
}

describe('Studio initial routing', () => {
  test('offers creation when there are no active memberships', () => {
    expect(resolveMembershipDestination([membership('old', 'terminated')])).toEqual({
      kind: 'create',
    })
  })

  test('enters directly when there is exactly one active membership', () => {
    expect(resolveMembershipDestination([membership('one')])).toEqual({
      kind: 'organization',
      organizationId: 'organization-one',
    })
  })

  test('requires selection when there are multiple active memberships', () => {
    const result = resolveMembershipDestination([membership('one'), membership('two')])
    expect(result.kind).toBe('select')
    if (result.kind === 'select') expect(result.memberships).toHaveLength(2)
  })
})

describe('Studio organization context', () => {
  test('resolves only the active membership for the organization in the URL', () => {
    const owner = membership('one')
    const coach = { ...membership('two'), roles: ['coach'] as Membership['roles'] }

    expect(resolveOrganizationContext([owner, coach], coach.organization_id)).toEqual({
      kind: 'ready',
      current: coach,
      memberships: [owner, coach],
    })
  })

  test('rejects an unknown organization', () => {
    expect(resolveOrganizationContext([membership('one')], 'organization-unknown')).toEqual({
      kind: 'forbidden',
    })
  })

  test('rejects a terminated membership and excludes it from switch targets', () => {
    const active = membership('active')
    const terminated = membership('old', 'terminated')

    expect(resolveOrganizationContext([active, terminated], terminated.organization_id)).toEqual({
      kind: 'forbidden',
    })
    expect(resolveOrganizationContext([terminated, active], active.organization_id)).toEqual({
      kind: 'ready',
      current: active,
      memberships: [active],
    })
  })

  test('keeps roles scoped to their own organization', () => {
    const owner = membership('one')
    const staff = { ...membership('two'), roles: ['staff'] as Membership['roles'] }

    const ownerContext = resolveOrganizationContext([owner, staff], owner.organization_id)
    const staffContext = resolveOrganizationContext([owner, staff], staff.organization_id)

    expect(ownerContext.kind === 'ready' ? ownerContext.current.roles : []).toEqual(['owner'])
    expect(staffContext.kind === 'ready' ? staffContext.current.roles : []).toEqual(['staff'])
  })
})
