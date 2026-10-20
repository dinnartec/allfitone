import { expect, test } from '@playwright/test'

import {
  activeCoach,
  activeMembership,
  activeTeamMember,
  coachedTeam,
  createStudioApiFixture,
  holderMembership,
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

/** A window the command would accept: starts tomorrow, ends a week later. */
function week() {
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  return { from: day(1), to: day(8) }
}

async function fillWindow(page: import('@playwright/test').Page) {
  const { from, to } = week()
  await page.getByLabel('Desde').fill(from)
  await page.getByLabel('Hasta').fill(to)
  return { from, to }
}

/*
 * The assertion this whole story turns on. `OP-REL-004` accepts the holder, and
 * no other action on this card does — a screen that reused the "may assign"
 * rule would hide the action from the one person who knows they will be away.
 */
test('the holder asks for cover on their own client, without any capability to assign', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [holderMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, holderMembership.organization_id)

  await page.getByRole('button', { name: 'Proponer suplencia' }).click()
  await page.getByRole('combobox', { name: 'Quién cubre' }).click()
  await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
  const { from, to } = await fillWindow(page)
  await page.getByRole('button', { name: 'Proponer y preguntar' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('[data-relationship-substitution-list]')).toContainText('Daniela Hoyos')

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/substitutions'),
  )
  expect(command?.body).toMatchObject({ starts_on: from, ends_on: to })
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

/*
 * The button says "Proponer", which reads like it takes effect. It does not,
 * and an administrator who assumes it does will think a client is covered when
 * nobody is. So the first sentence of the dialog denies it.
 */
test('the dialog says nothing happens until the person accepts, and that she is asked', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Proponer suplencia' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('No pasa nada hasta que la persona acepte')
  await expect(dialog).toContainText('un correo preguntándole')
  // The button itself carries the warning: there is no way to press it without
  // knowing an email goes out.
  await expect(dialog.getByRole('button', { name: 'Proponer y preguntar' })).toBeVisible()
})

// Covering yourself is not covering, and the command refuses it. Offering the
// holder spends a click to reach a refusal.
test('the holder is not offered as their own cover', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Proponer suplencia' }).click()
  await page.getByRole('combobox', { name: 'Quién cubre' }).click()

  await expect(page.getByRole('option', { name: 'Daniela Hoyos' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Camilo Restrepo' })).toBeHidden()
  await expect(page.getByRole('option', { name: 'Sara Posada' })).toBeHidden()
})

/*
 * The end date is not a form nicety. Access stops on it by itself, with no job
 * to run, so a cover without one would keep granting access to somebody's data
 * until a human noticed. The message has to carry that reason.
 */
test('a cover with no end date is refused before the round trip, and says why', async ({
  page,
}) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Proponer suplencia' }).click()
  await page.getByRole('combobox', { name: 'Quién cubre' }).click()
  await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
  await page.getByLabel('Desde').fill(week().from)
  await page.getByRole('button', { name: 'Proponer y preguntar' }).click()

  await expect(page.getByText('corta el acceso cuando termina')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/substitutions'),
    ),
  ).toHaveLength(0)
})

/*
 * A conflict here is not "somebody beat you to it": the same cover is already
 * waiting for an answer, which a partial unique index enforces. It is a state
 * the reader can see by refreshing, so it offers no retry.
 */
test('a cover already waiting for an answer is reported, not retried', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
    substitutionOutcome: 'already-proposed',
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Proponer suplencia' }).click()
  await page.getByRole('combobox', { name: 'Quién cubre' }).click()
  await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
  await fillWindow(page)
  await page.getByRole('button', { name: 'Proponer y preguntar' }).click()

  await expect(page.getByText('Esa suplencia ya está propuesta')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeHidden()
})

// Neither the holder nor an administrator: the command would refuse them, so
// the action is never offered.
test('a coach who neither holds nor may assign is not offered the action', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, secondActiveMembership.organization_id)

  await expect(page.locator('[data-relationship-holder]')).toContainText('Camilo Restrepo')
  await expect(page.getByRole('button', { name: 'Proponer suplencia' })).toBeHidden()
})

// A cover stands in for a holder. Where there is none the command refuses, and
// putting the first coach in charge is a different operation.
test('a client nobody attends is not offered a cover', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: { ...relationshipState, holder: null, substitutions: [] },
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.getByRole('button', { name: 'Proponer suplencia' })).toBeHidden()
})

/*
 * What STUDIO-94's migration changed on screen. The row policy now shows a
 * professional the covers of the clients they hold, so for the holder an empty
 * list really does mean there are none — and hedging would be the screen
 * refusing to say something it knows.
 */
test('the holder reads a definite empty list, not a hedged one', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [holderMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, holderMembership.organization_id)

  await expect(page.locator('[data-relationship-no-substitutions]')).toHaveText(
    'No hay suplencias registradas en este vínculo.',
  )
})

// And the hedge stays for a reader who really does see only part of the list.
test('a reader who sees only their own assignment is told so', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [secondActiveMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, secondActiveMembership.organization_id)

  await expect(page.locator('[data-relationship-no-substitutions]')).toContainText(
    'puede haber otras',
  )
})

/*
 * The start of a cover is a calendar day, and `OP-REL-004` stores it as
 * midnight UTC. Rendered as an instant in the reader's own zone that is the
 * evening before, so every reader west of Greenwich read a cover as starting a
 * day early. The timezone is pinned here rather than inherited, so the test
 * fails on a CI machine running UTC too.
 */
test.describe('read from Bogotá', () => {
  test.use({ timezoneId: 'America/Bogota' })

  test('shows the day a cover starts, not the evening before', async ({ page }) => {
    const fixture = createStudioApiFixture({
      memberships: [activeMembership],
      organizationMemberships: coachedTeam(),
      relationshipState: attended(),
    })
    await installStudioApiMock(page, fixture)
    await open(page, activeMembership.organization_id)

    await page.getByRole('button', { name: 'Proponer suplencia' }).click()
    await page.getByRole('combobox', { name: 'Quién cubre' }).click()
    await page.getByRole('option', { name: 'Daniela Hoyos' }).click()
    await page.getByLabel('Desde').fill('2030-03-15')
    await page.getByLabel('Hasta').fill('2030-03-22')
    await page.getByRole('button', { name: 'Proponer y preguntar' }).click()

    const list = page.locator('[data-relationship-substitution-list]')
    await expect(list).toContainText('Del 15/03/2030 al 22/03/2030')
    await expect(list).not.toContainText('14/03/2030')
  })
})

test('a gym with nobody else to cover says so', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: [activeTeamMember, activeCoach],
    relationshipState: attended(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await page.getByRole('button', { name: 'Proponer suplencia' }).click()

  await expect(page.getByText(/No hay otro entrenador activo/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Proponer y preguntar' })).toBeDisabled()
})
