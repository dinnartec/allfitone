import { describe, expect, test } from 'bun:test'

import type { Membership } from './studio-api.js'
import { resolveMembershipDestination } from './membership-routing.js'

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
