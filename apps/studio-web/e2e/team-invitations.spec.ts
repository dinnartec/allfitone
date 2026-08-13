import { expect, test } from '@playwright/test'

import { activeMembership, createStudioApiFixture, installStudioApiMock } from './studio-api-mock'

test('owner proposes a staff invitation without exposing contact in the URL', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}`)

  await page.getByRole('link', { name: 'Invitar integrante', exact: true }).click()
  await expect(page).toHaveURL(/\/team\/invitations\/new$/)
  await page.getByLabel('Correo electrónico').fill('person@example.test')
  await page.getByRole('button', { name: 'Enviar invitación' }).click()

  await expect(page.getByRole('heading', { name: 'La propuesta quedó pendiente.' })).toBeVisible()
  await expect(page.getByText('p***@example.test')).toBeVisible()
  await expect(page).not.toHaveURL(/person%40example\.test|person@example\.test/)

  const command = fixture.requests.find((request) => request.path.endsWith('/invitations'))
  expect(command?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  expect(command?.headers['command-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('cancel returns a directly opened form to the invitation list', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(`/organizations/${activeMembership.organization_id}/team/invitations/new`)

  await page.getByRole('button', { name: 'Cancelar' }).click()

  await expect(page).toHaveURL(
    `/organizations/${activeMembership.organization_id}/team/invitations`,
  )
})
