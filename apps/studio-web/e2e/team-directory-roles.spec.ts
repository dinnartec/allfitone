import { expect, test } from '@playwright/test'

import {
  activeMembership,
  activeTeamMember,
  createStudioApiFixture,
  installStudioApiMock,
  organizationRoleCatalog,
  secondActiveMembership,
  terminatedTeamMember,
} from './studio-api-mock'

test('owner consults the minimum team directory and navigates with real section links', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: [
      { ...activeTeamMember, email: 'must-not-render@example.test', person_id: 'hidden-person' },
      terminatedTeamMember,
    ],
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await expect(page.getByRole('heading', { name: 'Integrantes', level: 1 })).toBeVisible()
  const sidebar = page.locator('[data-organization-sidebar]')
  const sectionNavigation = page.getByRole('navigation', { name: 'Secciones del equipo' })
  await expect(sidebar.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Equipo', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toHaveCount(0)
  await expect(sectionNavigation.getByRole('link', { name: 'Integrantes' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sectionNavigation.getByRole('link', { name: 'Invitaciones' })).toBeVisible()
  await expect(sectionNavigation.getByRole('link', { name: 'Roles', exact: true })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Tabla de integrantes de la organización' }),
  ).toBeVisible()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
  await expect(page.getByText('Camila Torres', { exact: true })).toBeVisible()
  const directory = page.getByRole('region', { name: 'Tabla de integrantes de la organización' })
  await expect(directory.getByText('Propietario', { exact: true })).toBeVisible()
  await expect(directory.getByText('Staff', { exact: true })).toBeVisible()
  await expect(page.getByText('must-not-render@example.test')).toHaveCount(0)
  await expect(page.getByText('hidden-person')).toHaveCount(0)
  await expect(page.getByText(/no expone información de clientes ni datos fitness/i)).toBeVisible()

  await page.getByRole('button', { name: 'Finalizados' }).click()
  await expect(page.getByText('Camila Torres', { exact: true })).toBeVisible()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toHaveCount(0)
  expect(
    fixture.requests.some(
      (request) =>
        request.path.endsWith('/memberships') && request.search === '?status=terminated&limit=50',
    ),
  ).toBe(true)

  await sectionNavigation.getByRole('link', { name: 'Roles', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/organizations/${activeMembership.organization_id}/team/roles`)
  await expect(sectionNavigation.getByRole('link', { name: 'Roles', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('coach sees only the governed role catalog and never requests the team directory', async ({
  page,
}) => {
  const coachMembership = { ...secondActiveMembership, roles: ['coach'] }
  const fixture = createStudioApiFixture({ memberships: [coachMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${coachMembership.organization_id}/team`)

  // Every section exists for everyone and explains its own denial in place;
  // hiding a destination made the same label resolve to a different page per
  // person. This expected `Invitaciones` to be hidden, which was the one
  // section still doing the opposite, and left a coach who opened an invitation
  // URL on a page with no tab selected. The data itself is still never read.
  await expect(page.getByText('No tienes acceso a este directorio')).toBeVisible()
  const sectionNavigation = page.getByRole('navigation', { name: 'Secciones del equipo' })
  await expect(sectionNavigation.getByRole('link', { name: 'Integrantes' })).toBeVisible()
  await expect(sectionNavigation.getByRole('link', { name: 'Invitaciones' })).toBeVisible()
  await expect(sectionNavigation.getByRole('link', { name: 'Roles', exact: true })).toBeVisible()
  await expect(
    page.locator('[data-organization-sidebar]').getByRole('link', { name: 'Equipo' }),
  ).toHaveAttribute('href', `/organizations/${coachMembership.organization_id}/team`)
  expect(fixture.requests.filter(isOrganizationMembershipRequest)).toHaveLength(0)

  await page.getByRole('link', { name: 'Ver roles y permisos' }).click()
  await expect(page.getByRole('heading', { name: 'Roles y permisos', level: 1 })).toBeVisible()
  const cards = page.locator('[data-role-card]')
  await expect(cards).toHaveCount(4)
  expect(
    await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-role-card'))),
  ).toEqual(['owner', 'admin', 'coach', 'staff'])
  await expect(page.locator('[data-role-card="owner"]')).toContainText('15 capacidades')
  await expect(page.locator('[data-role-card="admin"]')).toContainText('13 capacidades')
  await expect(page.locator('[data-role-card="coach"]')).toContainText('8 capacidades')
  await expect(page.locator('[data-role-card="staff"]')).toContainText('3 capacidades')
  await expect(page.locator('[data-role-card="staff"]')).toContainText(
    'El rol no concede acceso a datos fitness.',
  )
  await expect(page.locator('[data-role-card="coach"]')).toContainText(
    'requiere relación, asignación, grant y condiciones profesionales vigentes',
  )
  await expect(
    page.getByText('Orientar nutrición únicamente con credencial verificada'),
  ).toHaveCount(0)
  await page
    .locator('[data-role-card="coach"]')
    .getByRole('button', { name: 'Ver capacidades' })
    .click()
  await expect(
    page.getByText('Orientar nutrición únicamente con credencial verificada'),
  ).toBeVisible()
})

/**
 * The directory used to carry a panel telling a solo owner that inviting was
 * optional. Onboarding says exactly that on the screen before this one, and the
 * condition behind the panel is permanent, so a professional working alone read
 * it on every visit forever. The invitation is still one click away.
 */
test('a solo owner keeps the invitation within reach and is not told about it again', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: [
      {
        ...activeTeamMember,
        membership_id: activeMembership.membership_id,
        display_name: 'Ada Lovelace',
      },
    ],
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await expect(page.getByRole('link', { name: 'Invitar integrante' })).toBeVisible()
  await expect(page.getByText(/sumar equipo/i)).toHaveCount(0)
  await expect(page.getByText('Opcional', { exact: true })).toHaveCount(0)
})

test('reuses the fresh active-membership query when opening the matching filter', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: [activeTeamMember, terminatedTeamMember],
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()

  const activeRequestsBeforeNavigation = fixture.requests.filter((request) => {
    if (!isOrganizationMembershipRequest(request)) return false
    return new URLSearchParams(request.search).get('status') === 'active'
  }).length

  await page.getByRole('link', { name: 'Ver equipo', exact: true }).click()
  await page.getByRole('button', { name: 'Activos' }).click()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()

  const activeRequestsAfterNavigation = fixture.requests.filter((request) => {
    if (!isOrganizationMembershipRequest(request)) return false
    return new URLSearchParams(request.search).get('status') === 'active'
  }).length
  expect(activeRequestsAfterNavigation).toBe(activeRequestsBeforeNavigation)
})

test('coach with staff role regains the directory destinations', async ({ page }) => {
  const combinedMembership = { ...secondActiveMembership, roles: ['coach', 'staff'] }
  const fixture = createStudioApiFixture({ memberships: [combinedMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${combinedMembership.organization_id}/team`)

  const sectionNavigation = page.getByRole('navigation', { name: 'Secciones del equipo' })
  await expect(sectionNavigation.getByRole('link', { name: 'Integrantes' })).toBeVisible()
  await expect(sectionNavigation.getByRole('link', { name: 'Invitaciones' })).toBeVisible()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
  expect(fixture.requests.filter(isOrganizationMembershipRequest).length).toBeGreaterThan(0)
})

for (const role of ['admin', 'staff'] as const) {
  test(`${role} membership can consult the team directory`, async ({ page }) => {
    const membership = { ...activeMembership, roles: [role] }
    const fixture = createStudioApiFixture({ memberships: [membership] })
    await installStudioApiMock(page, fixture)
    await page.goto(`/organizations/${membership.organization_id}/team`)

    await expect(page.getByRole('heading', { name: 'Integrantes', level: 1 })).toBeVisible()
    await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Invitaciones' })).toBeVisible()
    expect(fixture.requests.filter(isOrganizationMembershipRequest).length).toBeGreaterThan(0)
  })
}

test('recovers from a first-page failure into an actionable empty directory', async ({ page }) => {
  let attempts = 0
  let available = false
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (!isOrganizationMembershipRequest(request)) return undefined
      attempts += 1
      return available
        ? { status: 200, body: { data: [], page: { has_more: false, next_cursor: null } } }
        : { status: 503, body: { error: { code: 'upstream-unavailable' } } }
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await expect(page.getByText('No pudimos cargar el equipo')).toBeVisible()
  available = true
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByText('Todavía no hay integrantes para mostrar')).toBeVisible()
  expect(attempts).toBeGreaterThanOrEqual(2)
})

test('a slow previous filter never replaces the current membership filter', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: async (request) => {
      if (!isOrganizationMembershipRequest(request)) return undefined
      const status = new URLSearchParams(request.search).get('status')
      if (status === 'active') {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return {
          status: 200,
          body: { data: [activeTeamMember], page: { has_more: false, next_cursor: null } },
        }
      }
      if (status === 'terminated') {
        return {
          status: 200,
          body: { data: [terminatedTeamMember], page: { has_more: false, next_cursor: null } },
        }
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Activos' }).click()
  await page.getByRole('button', { name: 'Finalizados' }).click()

  await expect(page.getByText('Camila Torres', { exact: true })).toBeVisible()
  await page.waitForTimeout(400)
  await expect(page.getByText('Ada Lovelace', { exact: true })).toHaveCount(0)
})

test('pending pagination cannot append after the filter changes', async ({ page }) => {
  const pagedMember = {
    ...activeTeamMember,
    membership_id: '01991600-7000-7000-8000-000000000003',
    display_name: 'Respuesta tardía',
  }
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: async (request) => {
      if (!isOrganizationMembershipRequest(request)) return undefined
      const query = new URLSearchParams(request.search)
      if (query.get('cursor')) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return {
          status: 200,
          body: { data: [pagedMember], page: { has_more: false, next_cursor: null } },
        }
      }
      if (query.get('status') === 'terminated') {
        return {
          status: 200,
          body: { data: [terminatedTeamMember], page: { has_more: false, next_cursor: null } },
        }
      }
      return {
        status: 200,
        body: { data: [activeTeamMember], page: { has_more: true, next_cursor: 'page-2' } },
      }
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await page.getByRole('button', { name: 'Ver más' }).click()
  await page.getByRole('button', { name: 'Finalizados' }).click()

  await expect(page.getByText('Camila Torres', { exact: true })).toBeVisible()
  await page.waitForTimeout(400)
  await expect(page.getByText('Respuesta tardía')).toHaveCount(0)
})

test('an expired cursor keeps visible members and offers a first-page refresh', async ({
  page,
}) => {
  let firstPageRequests = 0
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request) => {
      if (!isOrganizationMembershipRequest(request)) return undefined
      const cursor = new URLSearchParams(request.search).get('cursor')
      if (cursor) return { status: 422, body: { error: { code: 'invalid-cursor' } } }
      firstPageRequests += 1
      return {
        status: 200,
        body: {
          data: [activeTeamMember],
          page: { has_more: true, next_cursor: 'expired-page' },
        },
      }
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team`)

  await page.getByRole('button', { name: 'Ver más' }).click()
  await expect(page.getByText('El equipo cambió')).toBeVisible()
  await expect(page.getByText('Ada Lovelace', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver más' })).toHaveCount(0)
  const requestsBeforeRefresh = firstPageRequests
  await page.getByRole('button', { name: 'Actualizar la lista' }).click()
  await expect(page.getByText('El equipo cambió')).toHaveCount(0)
  expect(firstPageRequests).toBe(requestsBeforeRefresh + 1)
})

for (const viewport of [
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test.describe(`team section on ${viewport.name}`, () => {
    test.use({ viewport })

    test('keeps the directory and role catalog inside the page viewport', async ({ page }) => {
      const fixture = createStudioApiFixture({
        memberships: [activeMembership],
        organizationRoles: organizationRoleCatalog,
      })
      await installStudioApiMock(page, fixture)
      await page.goto(`/organizations/${activeMembership.organization_id}/team`)

      // Either presentation is correct here. The register answers with a table
      // when its own container has the room for one and with cards when it does
      // not, so which one appears depends on the sidebar as much as on the
      // viewport — at 768px the sidebar is a drawer and the five columns still
      // ask for more than the page can give (see useCompactTable). What this
      // test guards is the names being readable either way, with no horizontal
      // scroll that nothing signals.
      const directory = page.locator('[data-team-page]')
      await expect(directory).toBeVisible()
      await expect(directory.getByText('Ada Lovelace', { exact: true })).toBeVisible()
      await expect(directory.getByText('Propietario', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )

      await page.getByRole('link', { name: 'Roles', exact: true }).click()
      await expect(page.locator('[data-role-card]')).toHaveCount(4)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  })
}

function isOrganizationMembershipRequest(request: { path: string }): boolean {
  return request.path.includes('/studio/v1/organizations/') && request.path.endsWith('/memberships')
}
