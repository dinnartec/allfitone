import { expect, test } from '@playwright/test'

import {
  activeCoach,
  activeMembership,
  activeTeamMember,
  coachedTeam,
  createStudioApiFixture,
  installStudioApiMock,
  relationshipState,
  secondActiveMembership,
} from './studio-api-mock'

const RELATIONSHIP = relationshipState.relationship_id

function attended() {
  return { ...relationshipState, substitutions: [] }
}

function open(page: import('@playwright/test').Page, organizationId: string) {
  return page.goto(`/organizations/${organizationId}/clients/${RELATIONSHIP}`)
}

test('an owner moves a client to another coach and the screen says who attends now', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')
  await page.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByRole('combobox', { name: 'Nuevo profesional responsable' }).click()
  await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
  await page.getByRole('button', { name: 'Cambiar y avisar' }).click()

  await expect(page.locator('[data-relationship-holder]')).toContainText('Daniela Hoyos')
  await expect(page.getByRole('dialog')).toBeHidden()

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/reassignment'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

/*
 * The three sentences are the dialog's reason to exist. An administrator
 * covering an absence will not guess that the client gets an email, and will
 * reasonably fear that moving the professional moves what the gym can see.
 */
test('the dialog warns about the email and denies the permission fear', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Cambiar' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('A la persona le llegará un correo')
  await expect(dialog).toContainText('Los permisos que la persona concedió no cambian')
  await expect(dialog).toContainText('dejará de tener acceso de inmediato')
})

// Offering the coach who already attends them would be a choice that changes
// nothing, notifies nobody, and leaves the reader wondering what happened.
test('the current professional is not offered as a destination', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByRole('combobox', { name: 'Nuevo profesional responsable' }).click()

  await expect(page.getByRole('option', { name: 'Daniela Hoyos' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Camilo Restrepo' })).toBeHidden()
  await expect(page.getByRole('option', { name: 'Sara Posada' })).toBeHidden()
})

test('a gym with nobody else to move the client to says so', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: [activeTeamMember, activeCoach],
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Cambiar' }).click()

  await expect(page.getByText(/No hay otro entrenador activo/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cambiar y avisar' })).toBeDisabled()
})

/*
 * A conflict here means there is nobody to take the client from any more. It
 * is a state the reader can see by refreshing, so it offers no retry — and
 * nothing was sent, which the copy says.
 */
test('a holder removed while the dialog was open is reported, not retried', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
    reassignmentOutcome: 'no-holder',
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Cambiar' }).click()
  await page.getByRole('combobox', { name: 'Nuevo profesional responsable' }).click()
  await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
  await page.getByRole('button', { name: 'Cambiar y avisar' }).click()

  await expect(page.getByText('Ya no hay a quién cambiarle este cliente')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeHidden()
})

// A coach holds `view_assigned_directory`, not `assign_professionals`, so the
// server would refuse them and the action is never offered.
test('a coach cannot move their own client to somebody else', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, secondActiveMembership.organization_id)

  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')
  await expect(page.getByRole('button', { name: 'Cambiar' })).toBeHidden()
})
