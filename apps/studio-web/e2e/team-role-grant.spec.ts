import { expect, test } from '@playwright/test'

import {
  activeMembership,
  activeTeamMember,
  createStudioApiFixture,
  installStudioApiMock,
  secondActiveMembership,
  terminatedTeamMember,
} from './studio-api-mock'

const STAFF_MEMBER = {
  membership_id: '01991600-7000-7000-8000-000000000004',
  display_name: 'Sara Posada',
  status: 'active',
  joined_at: '2025-05-20T10:00:00.000Z',
  ended_at: null,
  roles: ['staff'],
}

function team() {
  return [activeTeamMember, STAFF_MEMBER, terminatedTeamMember]
}

function openTeam(page: import('@playwright/test').Page, organizationId: string) {
  return page.goto(`/organizations/${organizationId}/team`)
}

test('an owner gives a staff member the coach role and the list says so', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, activeMembership.organization_id)

  await page.getByRole('button', { name: 'Añadir un rol a Sara Posada' }).click()
  await page.getByRole('combobox', { name: 'Rol' }).click()
  await page.getByRole('option', { name: 'Coach' }).click()
  await page.getByRole('button', { name: 'Otorgar rol' }).click()

  // Re-read rather than patched: what the next reader acts on came from the
  // server after the change.
  await expect(page.getByRole('dialog')).toBeHidden()
  const row = page.getByRole('row').filter({ hasText: 'Sara Posada' })
  await expect(row).toContainText('Coach')

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/roles'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.body).toEqual({ role_code: 'coach' })
})

/*
 * The sentence this dialog exists for. "Coach" sounds like it comes with
 * clients, and an owner promoting somebody will assume it does.
 */
test('the dialog says a role gives access to nobody data', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Añadir un rol a Sara Posada' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Un rol no da acceso a los datos de nadie')
  await expect(dialog).toContainText('categoría por categoría')
  await expect(dialog).toContainText('no alcanza nada de lo ya ocurrido')
})

// Criterion 1: ownership moves through a transfer, never through this command.
test('owner is not offered as a role', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Añadir un rol a Sara Posada' }).click()
  await page.getByRole('combobox', { name: 'Rol' }).click()

  await expect(page.getByRole('option', { name: 'Administrador' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Coach' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Propietario' })).toBeHidden()
})

// Criterion 4: a role somebody already holds is not offered, because granting
// it changes nothing and the reader would not know that.
test('a role the person already holds is not offered', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Añadir un rol a Sara Posada' }).click()
  await page.getByRole('combobox', { name: 'Rol' }).click()

  await expect(page.getByRole('option', { name: 'Staff' })).toBeHidden()
})

test('a membership that ended is not offered the action at all', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, activeMembership.organization_id)

  await expect(
    page.getByRole('button', { name: `Añadir un rol a ${terminatedTeamMember.display_name}` }),
  ).toBeHidden()
})

// A coach holds `view_assigned_directory`, not `manage_roles`.
test('a coach is not offered the action', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: team(),
  })
  await installStudioApiMock(page, fixture)
  await openTeam(page, secondActiveMembership.organization_id)

  await expect(page.getByRole('button', { name: /Añadir un rol/ })).toBeHidden()
})
