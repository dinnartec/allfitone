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
const RUNNING = '01991600-7000-7000-8000-000000000402'
const WAITING = relationshipState.substitutions[0]?.assignment_id ?? ''

/** The fixture's cover is `proposed`; this adds one that is actually running. */
function covered(status: 'active' | 'ended' = 'active') {
  return {
    ...relationshipState,
    substitutions: [
      {
        assignment_id: RUNNING,
        membership_id: '01991600-7000-7000-8000-000000000003',
        professional_person_id: '01991600-7000-7000-8000-000000000203',
        display_name: 'Daniela Hoyos',
        status,
        valid_from: '2026-10-10T00:00:00.000Z',
        ends_on: '2026-10-24',
        accepted_by_person_at: '2026-10-09T18:00:00.000Z',
      },
    ],
  }
}

function open(page: import('@playwright/test').Page, organizationId: string) {
  return page.goto(`/organizations/${organizationId}/clients/${RELATIONSHIP}`)
}

const endButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Terminar', exact: true })

/*
 * The sentence the whole dialog exists for. Ending a cover takes an access away
 * *now*, not on the day it was going to end, and somebody who expects otherwise
 * would cut a week of access without meaning to.
 */
test('says the access stops now, not on the day the cover ended', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await endButton(page).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('dejará de ver los datos de esta persona ahora mismo')
  await expect(dialog).toContainText('no el día que terminaba')
})

// The other half of the decision: what ending a cover does not undo.
test('says the holder keeps the client and the work is kept', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await endButton(page).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Camilo Restrepo')
  await expect(dialog).toContainText('se conserva')
})

test('ending a cover closes it in the list', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await endButton(page).click()
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect(page.locator('[data-relationship-substitution-list]')).toContainText('Terminada')

  const command = fixture.requests.find(
    (request) => request.method === 'POST' && request.path.endsWith('/termination'),
  )
  expect(command?.path).toContain(RUNNING)
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
})

/*
 * The asymmetry, on screen. `OP-REL-004` accepts the holder and `OP-REL-006`
 * does not: they may ask for a cover and may not call it off. Offering them the
 * button would spend a click to reach a refusal.
 */
test('the holder is not offered the action, though they may propose one', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [holderMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, holderMembership.organization_id)

  await expect(page.getByRole('button', { name: 'Proponer suplencia' })).toBeVisible()
  await expect(endButton(page)).toBeHidden()
})

// A cover nobody has answered grants no access, so there is nothing to cut.
// Withdrawing it is a different operation that does not exist yet.
test('a cover still waiting for an answer is not offered the action', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState,
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(page.locator('[data-relationship-substitution-list]')).toContainText(
    'Esperando respuesta',
  )
  expect(WAITING).not.toBe('')
  await expect(endButton(page)).toBeHidden()
})

test('a cover already over is not offered the action', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered('ended'),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)

  await expect(endButton(page)).toBeHidden()
})

/*
 * A `409` is a state the reader can see by refreshing — somebody else ended it,
 * or the person never accepted it. It is not an outage, so it offers no retry.
 */
test('a cover that is no longer running is reported, not retried', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
    substitutionEndOutcome: 'already-ended',
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await endButton(page).click()
  await page.getByRole('button', { name: 'Terminar ahora' }).click()

  await expect(page.getByText('Esa suplencia ya no está corriendo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeHidden()
})

// Cancelling leaves the cover running, which is the point of asking.
test('cancelling leaves the cover running', async ({ page }) => {
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    organizationMemberships: coachedTeam(),
    relationshipState: covered(),
  })
  await installStudioApiMock(page, fixture)
  await open(page, activeMembership.organization_id)
  await endButton(page).click()
  await page.getByRole('button', { name: 'Conservar la suplencia' }).click()

  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect(page.locator('[data-relationship-substitution-list]')).toContainText('Cubriendo')
  expect(
    fixture.requests.filter(
      (request) => request.method === 'POST' && request.path.endsWith('/termination'),
    ),
  ).toHaveLength(0)
})
