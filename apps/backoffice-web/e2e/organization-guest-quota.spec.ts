import { expect, test } from '@playwright/test'

import {
  activeSession,
  createBackofficeFixture,
  guestQuotaRecord,
  mockBackofficeApi,
  organizationFileRecord,
} from './backoffice-api-mock'

/**
 * `HU-BO-034` — fixing what a gym may fill, from the gym's own file.
 *
 * What is asserted here is what the screen has to say out loud: that no quota is no
 * limit rather than zero, that a number below the occupancy is warned about before it
 * is sent and ends nothing when it is, and that the duty this asks for is not the one
 * that opened the file.
 */

function gymWithoutQuota() {
  return organizationFileRecord()
}

test('a gym nobody sold a number to has no limit, and says nobody has set one', async ({
  context,
  page,
}) => {
  const record = gymWithoutQuota()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [record] },
    }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await expect(page.locator('[data-quota-seats]')).toContainText('No tiene cupo fijado')
  await expect(page.locator('[data-quota-occupancy]')).toContainText(
    'Ocupa 3: 2 relaciones vigentes y 1 invitación sin responder.',
  )
  await expect(page.locator('[data-quota-left]')).toContainText('no tiene límite')
  await expect(page.locator('[data-quota-last-change]')).toContainText('Nadie ha fijado el cupo')
  await expect(page.locator('[data-quota-unlimited-note]')).toBeVisible()
})

test('fixes a number and reads back what it replaced', async ({ context, page }) => {
  const record = gymWithoutQuota()
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await page.getByRole('checkbox', { name: 'Sin límite' }).click()
  await page.locator('#quota-seats').fill('50')
  await page.locator('[data-quota-save]').click()

  await expect(page.locator('[data-quota-outcome]')).toContainText('50 personas')
  await expect(page.locator('[data-quota-seats]')).toContainText('Puede tener 50 personas')
  await expect(page.locator('[data-quota-left]')).toContainText('Le quedan 47 lugares.')
  await expect(page.locator('[data-quota-last-change]')).toContainText('antes no tenía límite')

  const commands = fixture.requests.filter(
    (request) =>
      request.method === 'POST' &&
      request.path ===
        `/backoffice/v1/organizations/${record.organization.organization_id}/guest-quota`,
  )
  expect(commands).toHaveLength(1)
  expect(commands[0]?.body).toEqual({ seats: 50 })
  expect(commands[0]?.headers['idempotency-key']).toBeTruthy()
  expect(commands[0]?.headers['command-id']).toBeTruthy()
})

test('a number below the occupancy is warned about before it is sent, and ends nothing', async ({
  context,
  page,
}) => {
  const record = organizationFileRecord({
    guest_quota: guestQuotaRecord('placeholder', { seats: 50, places_left: 47 }),
  })
  record.guest_quota.organization_id = record.organization.organization_id
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await page.locator('#quota-seats').fill('1')
  await expect(page.locator('[data-quota-warning]')).toContainText('por debajo de lo que ya ocupa')
  await expect(page.locator('[data-quota-warning]')).toContainText('Nadie sale del gimnasio')

  await page.locator('[data-quota-save]').click()

  await expect(page.locator('[data-quota-seats]')).toContainText('Puede tener 1 persona')
  await expect(page.locator('[data-quota-left]')).toContainText('por encima de su cupo en 2')
  // The three people it already has are still there: the file still counts them.
  await expect(page.locator('[data-file-people-served]')).toContainText('Atiende a 3 personas')
})

test('removing the limit is its own decision, and an empty box is not one', async ({
  context,
  page,
}) => {
  const record = organizationFileRecord({
    guest_quota: guestQuotaRecord('placeholder', { seats: 50, places_left: 47 }),
  })
  record.guest_quota.organization_id = record.organization.organization_id
  const fixture = createBackofficeFixture({
    session: activeSession(),
    organizationFiles: { files: [record] },
  })
  await mockBackofficeApi(context, fixture)

  await page.goto(`/organizations/${record.organization.organization_id}`)

  // Clearing the field decides nothing: the command is refused before it is sent.
  await page.locator('#quota-seats').fill('')
  await page.locator('[data-quota-save]').click()
  await expect(page.locator('[data-quota-failure]')).toContainText('número de personas')

  await page.getByRole('checkbox', { name: 'Sin límite' }).click()
  await page.locator('[data-quota-save]').click()

  await expect(page.locator('[data-quota-outcome]')).toContainText('sin límite')
  await expect(page.locator('[data-quota-seats]')).toContainText('acuerdo sin tope')

  const commands = fixture.requests.filter(
    (request) =>
      request.method === 'POST' &&
      request.path ===
        `/backoffice/v1/organizations/${record.organization.organization_id}/guest-quota`,
  )
  expect(commands).toHaveLength(1)
  expect(commands[0]?.body).toEqual({ seats: null })
})

test('without the commercial duty the panel says which one is missing', async ({
  context,
  page,
}) => {
  const record = gymWithoutQuota()
  await mockBackofficeApi(
    context,
    createBackofficeFixture({
      session: activeSession(),
      organizationFiles: { files: [record] },
      guestQuota: { refusal: { status: 403, code: 'forbidden' } },
    }),
  )

  await page.goto(`/organizations/${record.organization.organization_id}`)

  await page.getByRole('checkbox', { name: 'Sin límite' }).click()
  await page.locator('#quota-seats').fill('50')
  await page.locator('[data-quota-save]').click()

  await expect(page.locator('[data-quota-failure]')).toContainText('manage_platform_commercial')
  // The file itself is still open: a refused command is not a refused read.
  await expect(page.getByRole('heading', { name: record.organization.display_name })).toBeVisible()
})
