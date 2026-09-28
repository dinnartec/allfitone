import { describe, expect, test } from 'bun:test'

import { resolveWorkspaceRoute } from './organization-navigation'

const organizationId = '01991600-1000-7000-8000-000000000002'
const basePath = `/organizations/${organizationId}`

describe('organization workspace navigation', () => {
  test('resolves the durable organization home', () => {
    expect(resolveWorkspaceRoute(basePath, organizationId)).toEqual({
      title: 'Inicio',
    })
  })

  test('resolves the organization details title', () => {
    expect(resolveWorkspaceRoute(`${basePath}/organization`, organizationId)).toEqual({
      title: 'Organización',
    })
  })

  test('resolves the new site title', () => {
    expect(resolveWorkspaceRoute(`${basePath}/organization/sites/new`, organizationId)).toEqual({
      title: 'Nueva sede',
    })
  })

  test('resolves the site edit title, whatever the site', () => {
    expect(
      resolveWorkspaceRoute(
        `${basePath}/organization/sites/01991600-2000-7000-8000-000000000001`,
        organizationId,
      ),
    ).toEqual({ title: 'Editar sede' })
  })

  test('the new-site route keeps its own title rather than matching the edit pattern', () => {
    expect(resolveWorkspaceRoute(`${basePath}/organization/sites/new`, organizationId)).toEqual({
      title: 'Nueva sede',
    })
  })

  test('resolves the governed role catalogue title without duplicating sidebar hierarchy', () => {
    const rolesPath = `${basePath}/team/roles`
    expect(resolveWorkspaceRoute(rolesPath, organizationId)).toEqual({
      title: 'Roles y permisos',
    })
  })

  test('resolves the invitation creation title', () => {
    expect(resolveWorkspaceRoute(`${basePath}/team/invitations/new`, organizationId)).toEqual({
      title: 'Nueva invitación',
    })
  })
})
