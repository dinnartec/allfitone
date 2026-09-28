import { expect, test } from '@playwright/test'

import {
  activeMembership,
  createStudioApiFixture,
  installStudioApiMock,
  chapineroSite,
  secondActiveMembership,
} from './studio-api-mock'

const organizationPath = `/organizations/${activeMembership.organization_id}/organization`
const editPath = `${organizationPath}/sites/${chapineroSite.id}`

test('renames a site and the list shows the new name', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(organizationPath)

  await page.getByRole('link', { name: `Editar ${chapineroSite.name}` }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${chapineroSite.id}$`))
  await expect(page.getByLabel('Nombre')).toHaveValue(chapineroSite.name)

  await page.getByLabel('Nombre').fill('Sede Chapinero Norte')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  await expect(
    page.getByRole('list', { name: 'Sedes de la organización' }).getByText('Sede Chapinero Norte'),
  ).toBeVisible()

  // Only the field that moved, and carrying the revision the screen was on.
  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({ name: 'Sede Chapinero Norte' })
  expect(saved?.headers['if-match']).toBe(
    `"organization-site:${chapineroSite.id}:r${chapineroSite.revision_number}"`,
  )
})

test('clearing the address sends null rather than an empty string', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByLabel('Dirección').fill('')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({ address: null })
})

test('with nothing changed there is nothing to save', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  // The contract requires at least one property, so an untouched form has
  // nothing legal to send and says so by being unavailable.
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()

  await page.getByLabel('Nombre').fill('Otro nombre')
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()

  await page.getByLabel('Nombre').fill(chapineroSite.name)
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  expect(fixture.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(0)
})

/**
 * Criterion 1 of HU-STUDIO-010. Withdrawing a site is the part people hesitate
 * over, so the confirmation states what it does not touch rather than leaving
 * them to find out.
 */
test('withdrawing a site says what it leaves alone, and keeps it on the list', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByRole('button', { name: 'Retirar de servicio', exact: true }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('No cambia relaciones, asignaciones ni historial')
  await dialog.getByRole('button', { name: 'Retirar de servicio' }).click()

  await expect(page).toHaveURL(new RegExp(`${organizationPath}$`))
  const sites = page.getByRole('list', { name: 'Sedes de la organización' })
  await expect(sites.getByText(chapineroSite.name)).toBeVisible()
  await expect(sites.getByRole('listitem').filter({ hasText: chapineroSite.name })).toContainText(
    'Inactiva',
  )

  const saved = fixture.requests.find((entry) => entry.method === 'PATCH')
  expect(saved?.body).toEqual({ status: 'inactive' })
})

test('a confirmation that is dismissed changes nothing', async ({ page }) => {
  const fixture = createStudioApiFixture({ memberships: [activeMembership] })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByRole('button', { name: 'Retirar de servicio', exact: true }).click()
  await page.getByRole('button', { name: 'Conservar como está' }).click()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(fixture.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(0)
})

/**
 * Two people editing one site. The save carries the revision the screen was
 * showing; the server compares it with the row it holds and refuses rather than
 * letting the second write erase the first.
 *
 * The message is the point: retrying with the same stale copy would overwrite
 * the other edit, so the only honest instruction is to look again.
 */
test('a site someone else saved first is refused, not overwritten', async ({ page }) => {
  let elsewhere = true
  const fixture = createStudioApiFixture({
    memberships: [activeMembership],
    intercept: (request, fixture) => {
      if (elsewhere && request.method === 'PATCH') {
        elsewhere = false
        // Someone else's save lands between this screen loading and its save.
        const organization = fixture.organization as {
          sites: Array<{ id: string; revision_number: number }>
        }
        const site = organization.sites.find((entry) => entry.id === chapineroSite.id)
        if (site) site.revision_number += 1
      }
      return undefined
    },
  })
  await installStudioApiMock(page, fixture)
  await page.goto(editPath)

  await page.getByLabel('Nombre').fill('Sede Chapinero Sur')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()

  await expect(page.getByText('Alguien más cambió esta sede mientras la editabas')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/sites/${chapineroSite.id}$`))
})

test('a role that does not manage sites cannot reach the edit screen', async ({ page }) => {
  await installStudioApiMock(
    page,
    createStudioApiFixture({ memberships: [secondActiveMembership] }),
  )
  const coachOrganization = `/organizations/${secondActiveMembership.organization_id}/organization`

  await page.goto(coachOrganization)
  await expect(page.getByRole('list', { name: 'Sedes de la organización' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Editar / })).toHaveCount(0)

  await page.goto(`${coachOrganization}/sites/${chapineroSite.id}`)
  await expect(page.getByText('Tu rol no administra las sedes')).toBeVisible()
  await expect(page.getByLabel('Nombre')).toHaveCount(0)
})
