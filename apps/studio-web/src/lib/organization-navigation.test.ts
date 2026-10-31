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

  /*
   * Without its own case this route fell through to the "Studio" fallback, so
   * the screen had a heading that named the product instead of the page. One
   * h1 was there, which is why the sweep passed; it just did not say where you
   * were.
   */
  test('resolves the organization edit title rather than the fallback', () => {
    expect(resolveWorkspaceRoute(`${basePath}/organization/edit`, organizationId)).toEqual({
      title: 'Editar datos',
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

  /*
   * A route missing from this map does not fail anywhere — it silently falls
   * through to "Studio", and the screen ships with the product's name where its
   * own title belongs. That is exactly what happened to the client directory.
   */
  test('resolves the client directory title rather than falling through to the default', () => {
    expect(resolveWorkspaceRoute(`${basePath}/clients`, organizationId)).toEqual({
      title: 'Clientes',
    })
  })

  test('resolves the information categories title', () => {
    expect(
      resolveWorkspaceRoute(`${basePath}/clients/information-categories`, organizationId),
    ).toEqual({ title: 'Categorías de información' })
  })

  /*
   * The relationship route is a bare `[^/]+` under `/clients`, so every static
   * route added beside it has to be excluded by name or it inherits "Vínculo".
   * This asserts both halves: the static one keeps its own title, and a real
   * relationship id still reaches the pattern.
   */
  test('a static route under clients is not mistaken for a relationship', () => {
    const relationshipId = '01991600-3000-7000-8000-000000000001'
    expect(resolveWorkspaceRoute(`${basePath}/clients/${relationshipId}`, organizationId)).toEqual({
      title: 'Vínculo',
    })
    for (const segment of ['invitations', 'information-categories']) {
      expect(resolveWorkspaceRoute(`${basePath}/clients/${segment}`, organizationId)).not.toEqual({
        title: 'Vínculo',
      })
    }
  })
})
