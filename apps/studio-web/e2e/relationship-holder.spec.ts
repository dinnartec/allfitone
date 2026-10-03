import { expect, test } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  installStudioApiMock,
  relationshipState,
  secondActiveMembership,
} from './studio-api-mock'

const RELATIONSHIP = relationshipState.relationship_id

function unattended() {
  return { ...relationshipState, holder: null, substitutions: [] }
}

test('an owner puts a coach in charge and the screen says who attends', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: unattended(),
  })
  await installStudioApiMock(page, fixture)

  // From the directory, the way somebody actually gets here: the client's name
  // is the link to their relationship.
  await page.goto(`/organizations/${activeMembership.organization_id}/clients`)
  await page.getByRole('link', { name: 'Ana Álvarez' }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${RELATIONSHIP}$`))

  await expect(page.getByText('Nadie la atiende todavía')).toBeVisible()
  await page.getByRole('combobox', { name: 'Profesional responsable' }).click()
  await page.getByRole('option', { name: 'Camilo Restrepo' }).click()
  await page.getByRole('button', { name: 'Asignar' }).click()

  // The screen re-reads rather than trusting what it sent, so this also proves
  // the refetch landed.
  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')
  await expect(page.getByText('Nadie la atiende todavía')).toBeHidden()

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/professional-assignments'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.body).toEqual({ membership_id: '01991600-7000-7000-8000-000000000002' })
})

/*
 * Criterion 1, and the only one the screen can get wrong on its own: the
 * command refuses anybody who is not an active coach of this organization, so
 * the list must not offer them. Sara is active staff and Camila is a coach who
 * left.
 */
test('the list offers only active coaches of this organization', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: unattended(),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/clients/${RELATIONSHIP}`)

  await page.getByRole('combobox', { name: 'Profesional responsable' }).click()
  await expect(page.getByRole('option', { name: 'Camilo Restrepo' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Daniela Hoyos' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Sara Posada' })).toBeHidden()
  await expect(page.getByRole('option', { name: 'Ada Lovelace' })).toBeHidden()
  await expect(page.getByRole('option', { name: 'Camila Torres' })).toBeHidden()
})

/*
 * The whole point of the story, and the easiest thing to lose later. Assigning
 * says who attends, never what they may read: nothing about a permission may
 * change because somebody was put in charge.
 */
test('assigning changes nobody permissions', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: unattended(),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/clients/${RELATIONSHIP}`)

  // Wait for the permissions to be on the page before snapshotting them: an
  // empty "before" would make this assertion pass without comparing anything.
  await expect(page.getByRole('row').first()).toBeVisible()
  const before = await page.getByRole('row').allInnerTexts()
  expect(before.length).toBeGreaterThan(1)

  await page.getByRole('combobox', { name: 'Profesional responsable' }).click()
  await page.getByRole('option', { name: 'Camilo Restrepo' }).click()
  await page.getByRole('button', { name: 'Asignar' }).click()
  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')

  expect(await page.getByRole('row').allInnerTexts()).toEqual(before)
})

// A coach holds `view_assigned_directory`, not `assign_professionals`. The
// server would refuse them, so the form is never offered.
test('a coach is not offered the assignment at all', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: unattended(),
  })
  await installStudioApiMock(page, fixture)
  await page.goto(
    `/organizations/${secondActiveMembership.organization_id}/clients/${RELATIONSHIP}`,
  )

  await expect(page.getByText('Nadie la atiende todavía')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Profesional responsable' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Asignar' })).toBeHidden()
})

// A relationship that already has somebody in charge is not re-assignable here:
// changing the holder is a separate operation that owes the person a notice.
test('a client who already has a professional is not offered the form', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: { ...relationshipState, substitutions: [] },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/clients/${RELATIONSHIP}`)

  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')
  await expect(page.getByRole('combobox', { name: 'Profesional responsable' })).toBeHidden()
})
