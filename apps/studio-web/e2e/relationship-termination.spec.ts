import { expect, test } from '@playwright/test'

import {
  activeMembership,
  coachedTeam,
  createStudioApiFixture,
  holderMembership,
  installStudioApiMock,
  relationshipState,
} from './studio-api-mock'

const RELATIONSHIP = relationshipState.relationship_id

function open(page: import('@playwright/test').Page, organizationId: string) {
  return page.goto(`/organizations/${organizationId}/clients/${RELATIONSHIP}`)
}

const terminateButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Terminar el vínculo' })

/*
 * The three sentences this dialog exists for, and each is something a reader
 * would otherwise assume wrongly.
 *
 * «It happens now» — somebody expecting "from the end of the month" cuts a
 * month of care today.
 */
test('says it happens now, without notice', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()

  await expect(page.getByRole('alertdialog')).toContainText('Pasa ahora mismo, sin preaviso')
})

/*
 * Both halves of what happens to the history, and in that order. «We keep it»
 * alone reads as surveillance; «we stop seeing it» alone reads as a purge.
 */
test('says what is kept and what stops being seen', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Lo que ya compartió se conserva')
  await expect(dialog).toContainText('no veremos nada de lo que pase después')
})

/*
 * Without this, «we keep it» sounds like «we can still look at it». Reading the
 * frozen history is a justified case, not a screen somebody opens.
 */
test('says the kept history needs a justified case', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()

  await expect(page.getByRole('alertdialog')).toContainText('abrir un caso justificado')
})

/*
 * The counts answer «how much am I cutting» before somebody cuts it, and they
 * ride in the first line rather than a paragraph of their own.
 */
test('counts what stops, in the question itself', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()

  await expect(page.getByRole('alertdialog')).toContainText(
    /Se cortan \d+ permisos y .*profesional/,
  )
})

/*
 * The notice is recorded by the command but nothing renders it yet
 * (STUDIO-151), so the screen must not promise it. This is the assertion that
 * fails the day somebody adds the sentence before the email exists.
 */
test('does not promise the person will be told', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).not.toContainText('correo')
  await expect(dialog).not.toContainText('le avisamos')
})

test('terminating closes the relationship on the page', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  await expect(page.getByRole('alertdialog')).toBeHidden()
  // And the action is gone: a relationship that ended cannot be ended again.
  await expect(terminateButton(page)).toBeHidden()

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/termination'),
  )
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
})

// A reason is optional: the gym owes the system no justification.
test('sends no reason when none was written', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/termination'),
  )
  expect(command?.body).toEqual({})
})

// But a blank one is not a reason, and it is refused before the round trip
// rather than trimmed away behind the caller's back.
test('a blank reason is refused before the round trip', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()
  await page.getByLabel('Motivo (opcional)').fill('   ')
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  await expect(page.getByText('Escribe un motivo o deja el campo vacío')).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/termination'),
    ),
  ).toHaveLength(0)
})

/*
 * `OP-REL-008` refuses a coach outright, even for a client they attend. The
 * holder sees everything else on this page and not this.
 */
test('the holder is not offered it, even for their own client', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [holderMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, holderMembership.organization_id)

  await expect(page.getByRole('button', { name: 'Proponer suplencia' })).toBeVisible()
  await expect(terminateButton(page)).toBeHidden()
})

test('a relationship that already ended is not offered it', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: { ...relationshipState, status: 'terminated' },
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(terminateButton(page)).toBeHidden()
})

/*
 * A `409` is somebody else having ended it while this page was open — a state
 * the reader can see by refreshing, so it offers no retry.
 */
test('a relationship ended elsewhere is reported, not retried', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
    terminationOutcome: 'already-ended',
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  await expect(page.getByText('Este vínculo ya no está activo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeHidden()
})

// Cancelling leaves everything as it was, which is the point of asking.
test('cancelling leaves the relationship alone', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await terminateButton(page).click()
  await page.getByRole('button', { name: 'Conservar el vínculo' }).click()

  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect(terminateButton(page)).toBeVisible()
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/termination'),
    ),
  ).toHaveLength(0)
})
